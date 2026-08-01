import { randomBytes } from "crypto";
import { head } from "@vercel/blob";
import { prisma } from "@/lib/db";
import {
  MAX_ACTIVE_STORY_SECONDS,
  MAX_STORY_AVG_BYTES_PER_SEC,
  MAX_STORY_CLIP_BYTES,
  MAX_STORY_CLIP_SECONDS,
  MAX_STORY_DELIVERY_BYTES,
  STORY_PLAYBACK_GRANT_MS,
  STORY_READY_STATUSES,
  STORY_TTL_MS,
  ALLOWED_STORY_VIDEO_TYPES,
  StoryUploadErrorCode,
  resolveStoryMime,
  type StoryClipPublic,
  type StoryUploadErrorCode as StoryErrorCode,
} from "@/lib/story-constants";
import {
  deleteStoredVideoForUser,
  getPublicBlobToken,
  pathnameBelongsToUser,
  storeVideoForUser,
} from "@/lib/storage";
import { revalidatePublicMemberSurfaces } from "@/lib/revalidate-public";

export class StoryUploadError extends Error {
  status: number;
  code: StoryErrorCode;
  requestId: string;

  constructor(
    code: StoryErrorCode,
    message: string,
    status = 400,
    requestId = randomBytes(6).toString("hex"),
  ) {
    super(message);
    this.name = "StoryUploadError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

export type { StoryClipPublic };

export type StoryRingState = {
  userId: string;
  hasActiveStory: boolean;
  hasUnseenStory: boolean;
};

const readyStatusList = [...STORY_READY_STATUSES];

export function activeStoryWhere(now = new Date()) {
  return {
    status: { in: readyStatusList },
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

/**
 * Batch ring state for Explore / feed / inbox.
 * One lightweight query (no video URLs). When viewerId is set, one extra views query.
 */
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
  const ownerFilter = {
    deletedAt: null,
    isAdmin: false,
    role: { not: "ADMIN" },
  } as const;

  // Anonymous / no unseen tracking: distinct owners only — cheapest ring path.
  if (!viewerId) {
    const owners = await prisma.storyClip.findMany({
      where: {
        userId: { in: unique },
        ...activeStoryWhere(now),
        user: ownerFilter,
      },
      distinct: ["userId"],
      select: { userId: true },
    });
    for (const row of owners) {
      const state = map.get(row.userId);
      if (state) {
        state.hasActiveStory = true;
        state.hasUnseenStory = true;
      }
    }
    return map;
  }

  const clips = await prisma.storyClip.findMany({
    where: {
      userId: { in: unique },
      ...activeStoryWhere(now),
      user: ownerFilter,
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

  return map;
}

export function validateStoryUploadMeta(opts: {
  mime: string;
  size: number;
  durationSec: number;
  /** When true, duration may be 0/NaN — server will probe later. */
  allowUnknownDuration?: boolean;
}): string | null {
  const mime = resolveStoryMime({ mime: opts.mime });
  if (!ALLOWED_STORY_VIDEO_TYPES.has(mime)) {
    return "Unsupported video type. Use MP4, MOV, or WebM.";
  }
  if (opts.size <= 0) return "Empty file.";
  if (opts.size > MAX_STORY_CLIP_BYTES) {
    return "Video too large. Each Story clip can be up to 100 MB.";
  }
  if (opts.size > MAX_STORY_DELIVERY_BYTES) {
    return "This video is too high-quality for reliable Story playback. Re-export at a lower bitrate (H.264 MP4, roughly 1080p or less) and try again.";
  }
  if (opts.allowUnknownDuration && (!Number.isFinite(opts.durationSec) || opts.durationSec <= 0)) {
    return null;
  }
  if (!Number.isFinite(opts.durationSec) || opts.durationSec <= 0) {
    return "Could not read video duration.";
  }
  if (opts.durationSec > MAX_STORY_CLIP_SECONDS + 0.5) {
    return "Each Story clip can be up to 90 seconds long.";
  }
  if (opts.size / opts.durationSec > MAX_STORY_AVG_BYTES_PER_SEC) {
    return "This video is too high-quality for reliable Story playback. Re-export at a lower bitrate (H.264 MP4, roughly 1080p or less) and try again.";
  }
  return null;
}

export function storyMetaErrorCode(message: string): StoryErrorCode {
  if (/too high-quality|bitrate|1080p/i.test(message)) {
    return StoryUploadErrorCode.BITRATE_TOO_HIGH;
  }
  if (/fast-start|web-optim|web optim/i.test(message)) {
    return StoryUploadErrorCode.NOT_FAST_START;
  }
  if (/too large|100 MB|50 MB/i.test(message)) return StoryUploadErrorCode.FILE_TOO_LARGE;
  if (/Unsupported video type|format/i.test(message)) {
    return StoryUploadErrorCode.UNSUPPORTED_FORMAT;
  }
  if (/90 seconds/i.test(message)) return StoryUploadErrorCode.DURATION_INVALID;
  if (/duration/i.test(message)) return StoryUploadErrorCode.DURATION_UNKNOWN;
  if (/90 minutes|active Story/i.test(message)) return StoryUploadErrorCode.QUOTA_EXCEEDED;
  return StoryUploadErrorCode.UNKNOWN;
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

/**
 * True when `moov` appears before `mdat` in the scanned prefix (fast-start).
 * False when `mdat` appears first (browser must download most of the file).
 * Null when neither atom is found in the buffer (inconclusive).
 */
export function mp4MoovIsBeforeMdat(buffer: Buffer): boolean | null {
  try {
    const len = buffer.length;
    let offset = 0;
    let sawMoov = false;
    let sawMdat = false;
    while (offset + 8 <= len) {
      let size = buffer.readUInt32BE(offset);
      const type = buffer.toString("ascii", offset + 4, offset + 8);
      let header = 8;
      if (size === 1) {
        if (offset + 16 > len) break;
        size = Number(buffer.readBigUInt64BE(offset + 8));
        header = 16;
      } else if (size === 0) {
        size = len - offset;
      }
      if (size < header) return null;
      if (type === "moov") {
        if (sawMdat) return false;
        sawMoov = true;
        return true;
      }
      if (type === "mdat") {
        if (sawMoov) return true;
        sawMdat = true;
        // keep scanning in case moov follows (non-fast-start)
      }
      offset += size;
    }
    if (sawMdat && !sawMoov) return false;
    if (sawMoov) return true;
    return null;
  } catch {
    return null;
  }
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
    throw new StoryUploadError(
      StoryUploadErrorCode.AUTH_FAILED,
      "Administrator accounts cannot post Stories",
      403,
    );
  }

  const mime = resolveStoryMime({
    mime: opts.file.type,
    filename: opts.file.name,
  });
  if (!mime) {
    throw new StoryUploadError(
      StoryUploadErrorCode.UNSUPPORTED_FORMAT,
      "Unsupported video type. Use MP4, MOV, or WebM.",
    );
  }
  const metaError = validateStoryUploadMeta({
    mime,
    size: opts.file.size,
    durationSec: opts.clientDurationSec,
    allowUnknownDuration: false,
  });
  if (metaError) {
    throw new StoryUploadError(storyMetaErrorCode(metaError), metaError);
  }

  const buffer = Buffer.from(await opts.file.arrayBuffer());
  const probed =
    mime.includes("mp4") || mime.includes("quicktime")
      ? probeMp4DurationSeconds(buffer)
      : null;
  if (mime.includes("mp4") || mime.includes("quicktime")) {
    const fastStart = mp4MoovIsBeforeMdat(buffer);
    if (fastStart === false) {
      throw new StoryUploadError(
        StoryUploadErrorCode.NOT_FAST_START,
        "This MP4 isn’t web-optimised (fast-start). Re-export with “fast start” / “web optimized” enabled and try again.",
      );
    }
  }
  const durationSeconds = Math.max(
    1,
    Math.round(probed && probed > 0 ? probed : opts.clientDurationSec),
  );
  if (durationSeconds > MAX_STORY_CLIP_SECONDS) {
    throw new StoryUploadError(
      StoryUploadErrorCode.DURATION_INVALID,
      "Each Story clip can be up to 90 seconds long.",
    );
  }
  const bitrateError = validateStoryUploadMeta({
    mime,
    size: opts.file.size,
    durationSec: durationSeconds,
  });
  if (bitrateError) {
    throw new StoryUploadError(storyMetaErrorCode(bitrateError), bitrateError);
  }

  const active = await getActiveDurationSeconds(opts.userId);
  if (active + durationSeconds > MAX_ACTIVE_STORY_SECONDS) {
    throw new StoryUploadError(
      StoryUploadErrorCode.QUOTA_EXCEEDED,
      "You currently have 90 minutes of active Story content. Delete a clip or wait for an older Story to expire before adding more.",
    );
  }

  const stored = await storeVideoForUser(opts.file, {
    userId: opts.userId,
    contentType: mime,
    filenameHint: opts.file.name,
  });
  if (!stored.ok) {
    throw new StoryUploadError(
      StoryUploadErrorCode.STORAGE_FAILED,
      stored.clientError || "Upload failed. Please try again.",
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
  } catch {
    await deleteStoredVideoForUser(stored.image.url, opts.userId);
    if (thumbnailUrl) await deleteStoredVideoForUser(thumbnailUrl, opts.userId);
    throw new StoryUploadError(
      StoryUploadErrorCode.DATABASE_FAILED,
      "We couldn’t save this Story. Your video has not been published.",
      500,
    );
  }
}

/**
 * Fetch a limited prefix of a public Blob for duration / fast-start probing
 * without loading the whole file into serverless memory.
 */
async function probeRemoteMp4Prefix(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: { Range: "bytes=0-2097151" },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!(res.ok || res.status === 206)) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function probeRemoteMp4Duration(url: string): Promise<number | null> {
  const buf = await probeRemoteMp4Prefix(url);
  if (!buf) return null;
  return probeMp4DurationSeconds(buf);
}

/**
 * Finalise a client direct-to-Blob upload into an ACTIVE StoryClip.
 * Verifies ownership, size, MIME, duration, and quota. Idempotent on uploadSessionId.
 */
export async function finalizeStoryFromBlob(opts: {
  userId: string;
  pathname: string;
  url: string;
  contentType?: string | null;
  size?: number | null;
  clientDurationSec?: number | null;
  uploadSessionId: string;
  originalFilename?: string | null;
  poster?: File | null;
  username?: string | null;
  slug?: string | null;
}) {
  if (opts.userId === "adminsource") {
    throw new StoryUploadError(
      StoryUploadErrorCode.AUTH_FAILED,
      "Administrator accounts cannot post Stories",
      403,
    );
  }

  const uploadSessionId = opts.uploadSessionId.trim().slice(0, 64);
  if (!uploadSessionId) {
    throw new StoryUploadError(
      StoryUploadErrorCode.UNKNOWN,
      "Missing upload session.",
    );
  }

  const existingBySession = await prisma.storyClip.findUnique({
    where: { uploadSessionId },
  });
  if (existingBySession) {
    if (existingBySession.userId !== opts.userId) {
      throw new StoryUploadError(
        StoryUploadErrorCode.OWNERSHIP_FAILED,
        "We couldn’t verify this upload. Please try again.",
        403,
      );
    }
    return existingBySession;
  }

  const pathname = opts.pathname.replace(/^\/+/, "");
  if (!pathnameBelongsToUser(pathname, opts.userId) || !pathname.startsWith(`stories/${opts.userId}/`)) {
    throw new StoryUploadError(
      StoryUploadErrorCode.OWNERSHIP_FAILED,
      "We couldn’t verify this upload. Please try again.",
      403,
    );
  }

  const existingByPath = await prisma.storyClip.findFirst({
    where: {
      userId: opts.userId,
      blobPathname: pathname,
      deletedAt: null,
      status: { in: ["ACTIVE", "PROCESSING"] },
    },
  });
  if (existingByPath) return existingByPath;

  const token = getPublicBlobToken();
  let blobMeta: { size: number; contentType: string | null; url: string; pathname: string };
  try {
    const meta = await head(pathname, token ? { token } : undefined);
    blobMeta = {
      size: meta.size,
      contentType: meta.contentType || null,
      url: meta.url,
      pathname: meta.pathname,
    };
  } catch {
    // Fallback: trust URL head via fetch if pathname head fails (store id / token mismatch edge cases)
    try {
      const res = await fetch(opts.url, {
        method: "HEAD",
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        throw new StoryUploadError(
          StoryUploadErrorCode.STORAGE_FAILED,
          "We couldn’t store this Story. Your video has not been published.",
        );
      }
      blobMeta = {
        size: Number(res.headers.get("content-length") || opts.size || 0),
        contentType: res.headers.get("content-type"),
        url: opts.url,
        pathname,
      };
    } catch (err) {
      if (err instanceof StoryUploadError) throw err;
      throw new StoryUploadError(
        StoryUploadErrorCode.STORAGE_FAILED,
        "We couldn’t store this Story. Your video has not been published.",
      );
    }
  }

  const mime = resolveStoryMime({
    mime: opts.contentType || blobMeta.contentType || "",
    filename: opts.originalFilename || pathname,
  });
  const size = blobMeta.size || opts.size || 0;
  const metaError = validateStoryUploadMeta({
    mime,
    size,
    durationSec: opts.clientDurationSec || 0,
    allowUnknownDuration: true,
  });
  if (metaError) {
    await deleteStoredVideoForUser(blobMeta.url || opts.url, opts.userId);
    throw new StoryUploadError(storyMetaErrorCode(metaError), metaError);
  }

  let probed: number | null = null;
  let prefix: Buffer | null = null;
  if (mime.includes("mp4") || mime.includes("quicktime")) {
    prefix = await probeRemoteMp4Prefix(blobMeta.url || opts.url);
    if (prefix) {
      probed = probeMp4DurationSeconds(prefix);
      const fastStart = mp4MoovIsBeforeMdat(prefix);
      if (fastStart === false) {
        await deleteStoredVideoForUser(blobMeta.url || opts.url, opts.userId);
        throw new StoryUploadError(
          StoryUploadErrorCode.NOT_FAST_START,
          "This MP4 isn’t web-optimised (fast-start). Re-export with “fast start” / “web optimized” enabled and try again.",
        );
      }
    } else {
      probed = await probeRemoteMp4Duration(blobMeta.url || opts.url);
    }
  }
  const clientDur = Number(opts.clientDurationSec);
  const durationSeconds = Math.max(
    1,
    Math.round(
      probed && probed > 0
        ? probed
        : Number.isFinite(clientDur) && clientDur > 0
          ? clientDur
          : 0,
    ),
  );
  if (!probed && !(Number.isFinite(clientDur) && clientDur > 0)) {
    await deleteStoredVideoForUser(blobMeta.url || opts.url, opts.userId);
    throw new StoryUploadError(
      StoryUploadErrorCode.DURATION_UNKNOWN,
      "We could not verify this video’s length. Try another clip or a shorter recording.",
    );
  }
  if (durationSeconds > MAX_STORY_CLIP_SECONDS) {
    await deleteStoredVideoForUser(blobMeta.url || opts.url, opts.userId);
    throw new StoryUploadError(
      StoryUploadErrorCode.DURATION_INVALID,
      "Each Story clip can be up to 90 seconds long.",
    );
  }

  const bitrateError = validateStoryUploadMeta({
    mime,
    size,
    durationSec: durationSeconds,
    allowUnknownDuration: false,
  });
  if (bitrateError) {
    await deleteStoredVideoForUser(blobMeta.url || opts.url, opts.userId);
    throw new StoryUploadError(storyMetaErrorCode(bitrateError), bitrateError);
  }

  const active = await getActiveDurationSeconds(opts.userId);
  if (active + durationSeconds > MAX_ACTIVE_STORY_SECONDS) {
    await deleteStoredVideoForUser(blobMeta.url || opts.url, opts.userId);
    throw new StoryUploadError(
      StoryUploadErrorCode.QUOTA_EXCEEDED,
      "You currently have 90 minutes of active Story content. Delete a clip or wait for an older Story to expire before adding more.",
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
        videoUrl: blobMeta.url || opts.url,
        blobPathname: pathname,
        thumbnailUrl,
        thumbnailBlobPathname,
        durationSeconds,
        fileSizeBytes: size,
        mimeType: mime,
        status: "ACTIVE",
        originalFilename: (opts.originalFilename || "").slice(0, 120),
        uploadSessionId,
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
    // Unique race on uploadSessionId — return winner
    const raced = await prisma.storyClip.findUnique({
      where: { uploadSessionId },
    });
    if (raced && raced.userId === opts.userId) return raced;

    await deleteStoredVideoForUser(blobMeta.url || opts.url, opts.userId);
    if (thumbnailUrl) await deleteStoredVideoForUser(thumbnailUrl, opts.userId);
    console.error("[stories:finalize]", err);
    throw new StoryUploadError(
      StoryUploadErrorCode.DATABASE_FAILED,
      "We couldn’t save this Story. Your video has not been published.",
      500,
    );
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
      status: { in: [...readyStatusList, "PROCESSING"] },
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
        deletedAt: new Date(),
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

/**
 * Authorised playback grant for a ready clip.
 * Stories are stored on the public Blob store and streamed directly from CDN
 * (not proxied through Next.js). The grant adds a client refresh window.
 */
export async function getClipPlaybackGrant(clipId: string) {
  const clip = await prisma.storyClip.findFirst({
    where: { id: clipId, ...activeStoryWhere() },
    select: {
      id: true,
      userId: true,
      videoUrl: true,
      mimeType: true,
      status: true,
      expiresAt: true,
      fileSizeBytes: true,
    },
  });
  if (!clip) return null;
  if (clip.status === "FAILED" || clip.status === "PROCESSING") return null;

  const grantExpiresAt = new Date(
    Math.min(Date.now() + STORY_PLAYBACK_GRANT_MS, clip.expiresAt.getTime()),
  );

  return {
    clipId: clip.id,
    userId: clip.userId,
    playbackUrl: clip.videoUrl,
    contentType: clip.mimeType || "video/mp4",
    expiresAt: grantExpiresAt.toISOString(),
    storyExpiresAt: clip.expiresAt.toISOString(),
    fileSizeBytes: clip.fileSizeBytes,
    delivery: "direct-blob-cdn" as const,
  };
}
