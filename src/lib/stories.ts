import { prisma } from "@/lib/db";
import {
  MAX_ACTIVE_STORY_SECONDS,
  MAX_STORY_CLIP_BYTES,
  MAX_STORY_CLIP_SECONDS,
  STORY_TTL_MS,
  ALLOWED_STORY_VIDEO_TYPES,
  type StoryClipPublic,
} from "@/lib/story-constants";
import {
  deleteStoredVideoForUser,
  storeVideoForUser,
} from "@/lib/storage";
import { revalidatePublicMemberSurfaces } from "@/lib/revalidate-public";

export type { StoryClipPublic };

export type StoryRingState = {
  userId: string;
  hasActiveStory: boolean;
  hasUnseenStory: boolean;
};

const activeClipWhere = {
  status: "ACTIVE" as const,
  deletedAt: null,
  expiresAt: { gt: new Date() },
};

export function activeStoryWhere(now = new Date()) {
  return {
    status: "ACTIVE",
    deletedAt: null,
    expiresAt: { gt: now },
  };
}

export function mapClipPublic(
  clip: {
    id: string;
    userId: string;
    videoUrl: string;
    thumbnailUrl: string;
    durationSeconds: number;
    createdAt: Date;
    expiresAt: Date;
    _count?: { views: number };
  },
  includeViews = false,
): StoryClipPublic {
  return {
    id: clip.id,
    userId: clip.userId,
    videoUrl: clip.videoUrl,
    thumbnailUrl: clip.thumbnailUrl,
    durationSeconds: clip.durationSeconds,
    createdAt: clip.createdAt.toISOString(),
    expiresAt: clip.expiresAt.toISOString(),
    ...(includeViews
      ? { viewCount: clip._count?.views ?? 0 }
      : {}),
  };
}

export async function getActiveDurationSeconds(userId: string): Promise<number> {
  const clips = await prisma.storyClip.findMany({
    where: { userId, ...activeStoryWhere() },
    select: { durationSeconds: true },
  });
  return clips.reduce((sum, c) => sum + Math.max(0, c.durationSeconds), 0);
}

export async function listActiveClipsForUser(userId: string) {
  return prisma.storyClip.findMany({
    where: { userId, ...activeStoryWhere() },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

export async function listActiveClipsForOwner(userId: string) {
  return prisma.storyClip.findMany({
    where: { userId, ...activeStoryWhere() },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { _count: { select: { views: true } } },
  });
}

/** Batch ring state for Explore / feed / inbox. Avoids N+1 and never returns video URLs. */
export async function getStoryRingStates(
  userIds: string[],
  viewerId?: string | null,
): Promise<Map<string, StoryRingState>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  const map = new Map<string, StoryRingState>();
  for (const id of unique) {
    map.set(id, {
      userId: id,
      hasActiveStory: false,
      hasUnseenStory: false,
    });
  }
  if (!unique.length) return map;

  const now = new Date();
  const clips = await prisma.storyClip.findMany({
    where: {
      userId: { in: unique },
      status: "ACTIVE",
      deletedAt: null,
      expiresAt: { gt: now },
      user: {
        deletedAt: null,
        isAdmin: false,
        role: { not: "ADMIN" },
      },
    },
    select: { id: true, userId: true },
    orderBy: { createdAt: "asc" },
  });

  const byUser = new Map<string, string[]>();
  for (const c of clips) {
    const list = byUser.get(c.userId) || [];
    list.push(c.id);
    byUser.set(c.userId, list);
    const state = map.get(c.userId);
    if (state) state.hasActiveStory = true;
  }

  if (viewerId) {
    const allClipIds = clips.map((c) => c.id);
    if (allClipIds.length) {
      const views = await prisma.storyView.findMany({
        where: {
          viewerUserId: viewerId,
          storyClipId: { in: allClipIds },
        },
        select: { storyClipId: true },
      });
      const viewed = new Set(views.map((v) => v.storyClipId));
      for (const [userId, clipIds] of byUser) {
        const state = map.get(userId);
        if (!state) continue;
        state.hasUnseenStory = clipIds.some((id) => !viewed.has(id));
      }
    }
  } else {
    for (const [userId] of byUser) {
      const state = map.get(userId);
      if (state?.hasActiveStory) state.hasUnseenStory = true;
    }
  }

  return map;
}

export function validateStoryUploadMeta(opts: {
  mime: string;
  size: number;
  durationSec: number;
}): string | null {
  const mime = opts.mime === "video/jpg" ? "video/mp4" : opts.mime;
  if (!ALLOWED_STORY_VIDEO_TYPES.has(mime) && !ALLOWED_STORY_VIDEO_TYPES.has(opts.mime)) {
    return "Unsupported video type. Use MP4, MOV, or WebM.";
  }
  if (opts.size <= 0) return "Empty file.";
  if (opts.size > MAX_STORY_CLIP_BYTES) {
    return "Video too large. Each Story clip can be up to 50 MB.";
  }
  if (!Number.isFinite(opts.durationSec) || opts.durationSec <= 0) {
    return "Could not read video duration.";
  }
  if (opts.durationSec > MAX_STORY_CLIP_SECONDS + 0.5) {
    return "Each Story clip can be up to 90 seconds long.";
  }
  return null;
}

/**
 * Best-effort MP4 duration from mvhd atom (seconds). Returns null when not MP4 or parse fails.
 */
export function probeMp4DurationSeconds(buffer: Buffer): number | null {
  try {
    const len = buffer.length;
    let offset = 0;
    while (offset + 8 < len) {
      const size = buffer.readUInt32BE(offset);
      const type = buffer.toString("ascii", offset + 4, offset + 8);
      if (size < 8) return null;
      if (type === "moov" || type === "trak" || type === "mdia") {
        // descend
        offset += 8;
        continue;
      }
      if (type === "mvhd") {
        const version = buffer.readUInt8(offset + 8);
        if (version === 0) {
          const timescale = buffer.readUInt32BE(offset + 20);
          const duration = buffer.readUInt32BE(offset + 24);
          if (timescale > 0) return duration / timescale;
        } else if (version === 1) {
          const timescale = buffer.readUInt32BE(offset + 28);
          const high = buffer.readUInt32BE(offset + 32);
          const low = buffer.readUInt32BE(offset + 36);
          const duration = high * 2 ** 32 + low;
          if (timescale > 0) return duration / timescale;
        }
        return null;
      }
      offset += size === 1 ? Number(buffer.readBigUInt64BE(offset + 8)) : size;
    }
  } catch {
    return null;
  }
  return null;
}

export async function createStoryClip(opts: {
  userId: string;
  file: File;
  clientDurationSec: number;
  poster?: File | null;
  username?: string | null;
  slug?: string | null;
}) {
  if (opts.userId === "adminsource") {
    throw Object.assign(new Error("Administrator accounts cannot post Stories"), {
      status: 403,
    });
  }

  const mime = opts.file.type || "video/mp4";
  const metaError = validateStoryUploadMeta({
    mime,
    size: opts.file.size,
    durationSec: opts.clientDurationSec,
  });
  if (metaError) {
    throw Object.assign(new Error(metaError), { status: 400 });
  }

  const buffer = Buffer.from(await opts.file.arrayBuffer());
  const probed =
    mime.includes("mp4") || mime.includes("quicktime")
      ? probeMp4DurationSeconds(buffer)
      : null;
  const durationSeconds = Math.max(
    1,
    Math.round(probed && probed > 0 ? probed : opts.clientDurationSec),
  );
  if (durationSeconds > MAX_STORY_CLIP_SECONDS) {
    throw Object.assign(
      new Error("Each Story clip can be up to 90 seconds long."),
      { status: 400 },
    );
  }

  const active = await getActiveDurationSeconds(opts.userId);
  if (active + durationSeconds > MAX_ACTIVE_STORY_SECONDS) {
    throw Object.assign(
      new Error(
        "You currently have 90 minutes of active Story content. Delete a clip or wait for an older Story to expire before adding more.",
      ),
      { status: 400 },
    );
  }

  const stored = await storeVideoForUser(opts.file, {
    userId: opts.userId,
    contentType: mime,
    filenameHint: opts.file.name,
  });
  if (!stored.ok) {
    throw Object.assign(
      new Error(stored.clientError || stored.error || "Upload failed"),
      { status: 400 },
    );
  }

  let thumbnailUrl = "";
  let thumbnailBlobPathname = "";
  if (opts.poster && opts.poster.size > 0) {
    const { storeImageForUser } = await import("@/lib/storage");
    const poster = await storeImageForUser(opts.poster, {
      userId: opts.userId,
      folder: "stories",
    });
    if (poster.ok) {
      thumbnailUrl = poster.image.url;
      thumbnailBlobPathname = poster.image.pathname || "";
    }
  }

  const now = new Date();
  try {
    const clip = await prisma.storyClip.create({
      data: {
        userId: opts.userId,
        videoUrl: stored.image.url,
        blobPathname: stored.image.pathname || "",
        thumbnailUrl,
        thumbnailBlobPathname,
        durationSeconds,
        fileSizeBytes: opts.file.size,
        mimeType: mime,
        status: "ACTIVE",
        originalFilename: (opts.file.name || "").slice(0, 120),
        createdAt: now,
        expiresAt: new Date(now.getTime() + STORY_TTL_MS),
      },
    });
    revalidatePublicMemberSurfaces({
      slug: opts.slug,
      username: opts.username,
    });
    return clip;
  } catch (err) {
    await deleteStoredVideoForUser(stored.image.url, opts.userId);
    if (thumbnailUrl) await deleteStoredVideoForUser(thumbnailUrl, opts.userId);
    throw err;
  }
}

export async function deleteStoryClip(opts: {
  clipId: string;
  userId: string;
  username?: string | null;
  slug?: string | null;
}) {
  const clip = await prisma.storyClip.findFirst({
    where: { id: opts.clipId, userId: opts.userId, deletedAt: null },
  });
  if (!clip) {
    throw Object.assign(new Error("Story clip not found"), { status: 404 });
  }

  await prisma.storyClip.update({
    where: { id: clip.id },
    data: { status: "DELETED", deletedAt: new Date() },
  });

  await deleteStoredVideoForUser(clip.videoUrl, opts.userId);
  if (clip.thumbnailUrl) {
    await deleteStoredVideoForUser(clip.thumbnailUrl, opts.userId);
  }

  revalidatePublicMemberSurfaces({
    slug: opts.slug,
    username: opts.username,
  });
}

export async function recordStoryView(opts: {
  clipId: string;
  viewerUserId: string | null;
}) {
  const clip = await prisma.storyClip.findFirst({
    where: { id: opts.clipId, ...activeStoryWhere() },
    select: { id: true, userId: true },
  });
  if (!clip) return { recorded: false, reason: "not_found" as const };
  // Owner preview must not inflate public count.
  if (opts.viewerUserId && opts.viewerUserId === clip.userId) {
    return { recorded: false, reason: "owner" as const };
  }
  if (!opts.viewerUserId) {
    return { recorded: false, reason: "anonymous_skipped" as const };
  }

  try {
    await prisma.storyView.create({
      data: {
        storyClipId: clip.id,
        viewerUserId: opts.viewerUserId,
      },
    });
    return { recorded: true as const };
  } catch {
    // Unique violation — already viewed
    return { recorded: false, reason: "duplicate" as const };
  }
}

export async function expireStoryClips(limit = 200) {
  const now = new Date();
  const expired = await prisma.storyClip.findMany({
    where: {
      status: "ACTIVE",
      OR: [{ expiresAt: { lte: now } }, { deletedAt: { not: null } }],
    },
    take: limit,
    select: {
      id: true,
      userId: true,
      videoUrl: true,
      thumbnailUrl: true,
      blobPathname: true,
      thumbnailBlobPathname: true,
    },
  });

  let cleaned = 0;
  for (const clip of expired) {
    await prisma.storyClip.update({
      where: { id: clip.id },
      data: {
        status: "EXPIRED",
        deletedAt: clip ? new Date() : new Date(),
      },
    });
    await deleteStoredVideoForUser(clip.videoUrl, clip.userId);
    if (clip.thumbnailUrl) {
      await deleteStoredVideoForUser(clip.thumbnailUrl, clip.userId);
    }
    await prisma.storyView.deleteMany({ where: { storyClipId: clip.id } });
    cleaned += 1;
  }
  return { scanned: expired.length, cleaned };
}

// silence unused import warning for activeClipWhere if any
void activeClipWhere;
