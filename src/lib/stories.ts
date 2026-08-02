import { randomBytes } from "crypto";
import { head } from "@vercel/blob";
import { prisma } from "@/lib/db";
import {
  MAX_ACTIVE_STORY_SECONDS,
  MAX_STORY_CLIP_BYTES,
  MAX_STORY_CLIP_SECONDS,
  STORY_PLAYBACK_GRANT_MS,
  STORY_PROCESSING_TTL_MS,
  STORY_READY_STATUSES,
  STORY_TTL_MS,
  ALLOWED_STORY_VIDEO_TYPES,
  StoryUploadErrorCode,
  resolveStoryMime,
  type StoryClipPublic,
  type StoryDelivery,
  type StoryUploadErrorCode as StoryErrorCode,
} from "@/lib/story-constants";
import {
  deleteStoredVideoForUser,
  getPublicBlobToken,
  pathnameBelongsToUser,
  storeVideoForUser,
} from "@/lib/storage";
import {
  createMuxDirectUpload,
  deleteMuxAsset,
  isMuxConfigured,
  muxHlsUrl,
  muxMp4Url,
  muxThumbnailUrl,
} from "@/lib/mux-stories";
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

const readyStatusList: string[] = [...STORY_READY_STATUSES];

/** Statuses that consume the owner’s 90-minute allowance before they go public. */
const inFlightStatusList: string[] = ["UPLOADING", "PROCESSING"];

/** Public rings / viewer: only clips that are actually playable right now. */
export function activeStoryWhere(now = new Date()) {
  return {
    status: { in: readyStatusList },
    deletedAt: null,
    expiresAt: { gt: now },
  };
}

/**
 * Owner-facing set: everything the uploader should still see, including clips
 * Mux has not finished transcoding. Never used for public surfaces.
 */
export function ownerStoryWhere(now = new Date()) {
  return {
    status: { in: [...readyStatusList, ...inFlightStatusList] },
    deletedAt: null,
    expiresAt: { gt: now },
  };
}

type ClipRecordLike = {
  id: string;
  userId: string;
  videoUrl: string;
  thumbnailUrl: string;
  durationSeconds: number;
  createdAt: Date;
  expiresAt: Date;
  status?: string;
  muxPlaybackId?: string | null;
  _count?: { views: number };
};

export function mapClipPublic(
  clip: ClipRecordLike,
  includeViews = false,
  includeStatus = false,
): StoryClipPublic {
  const playbackId = clip.muxPlaybackId || "";
  const hlsUrl = playbackId ? muxHlsUrl(playbackId) : "";
  const mp4Url = playbackId ? muxMp4Url(playbackId) : "";
  return {
    id: clip.id,
    userId: clip.userId,
    videoUrl: clip.videoUrl || hlsUrl,
    thumbnailUrl: clip.thumbnailUrl,
    durationSeconds: clip.durationSeconds,
    createdAt: clip.createdAt.toISOString(),
    expiresAt: clip.expiresAt.toISOString(),
    delivery: (playbackId
      ? "mux-cdn"
      : "direct-blob-cdn") satisfies StoryDelivery,
    ...(playbackId ? { hlsUrl, mp4Url } : {}),
    ...(includeViews ? { viewCount: clip._count?.views ?? 0 } : {}),
    ...(includeStatus ? { status: clip.status || "" } : {}),
  };
}

/**
 * Allowance usage. Counts PROCESSING clips too, so a member cannot queue
 * unlimited uploads while Mux is still transcoding.
 */
export async function getActiveDurationSeconds(userId: string): Promise<number> {
  const clips = await prisma.storyClip.findMany({
    where: { userId, ...ownerStoryWhere() },
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
 * Owner’s Manage Story list — includes PROCESSING clips (and recently FAILED
 * ones) so the uploader can see progress instead of an empty list.
 */
export async function listOwnerClips(userId: string) {
  const now = new Date();
  const recentFailedCutoff = new Date(now.getTime() - STORY_TTL_MS);
  return prisma.storyClip.findMany({
    where: {
      userId,
      deletedAt: null,
      OR: [
        ownerStoryWhere(now),
        { status: "FAILED", createdAt: { gt: recentFailedCutoff } },
      ],
    },
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

/**
 * Upload gate. Deliberately does NOT inspect bitrate or MP4 atom order —
 * Mux re-encodes every accepted clip, so high-bitrate phone originals are fine.
 * Rejects only: wrong type, empty, over 500 MB, over 90 seconds.
 */
export function validateStoryUploadMeta(opts: {
  mime: string;
  size: number;
  durationSec: number;
  /** When true, duration may be 0/NaN — Mux reports the real duration on ready. */
  allowUnknownDuration?: boolean;
}): string | null {
  const mime = resolveStoryMime({ mime: opts.mime });
  if (!ALLOWED_STORY_VIDEO_TYPES.has(mime)) {
    return "Unsupported video type. Use MP4, MOV, or WebM.";
  }
  if (opts.size <= 0) return "Empty file.";
  if (opts.size > MAX_STORY_CLIP_BYTES) {
    return "Video too large. Each Story clip can be up to 500 MB.";
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
  return null;
}

export function storyMetaErrorCode(message: string): StoryErrorCode {
  if (/too large|500 MB/i.test(message)) return StoryUploadErrorCode.FILE_TOO_LARGE;
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

  const active = await getActiveDurationSeconds(opts.userId);
  if (active + durationSeconds > MAX_ACTIVE_STORY_SECONDS) {
    throw new StoryUploadError(
      StoryUploadErrorCode.QUOTA_EXCEEDED,
      "You currently have 90 minutes of active Story content. Delete a clip or wait for an older Story to expire before adding more.",
    );
  }

  // Preferred path: hand the bytes to Mux and let the webhook publish the clip.
  if (isMuxConfigured()) {
    return uploadProxyClipToMux({
      userId: opts.userId,
      buffer,
      mime,
      durationSeconds,
      originalFilename: opts.file.name,
    });
  }
  // No transcoding service in production — refuse rather than publish a raw file.
  if (process.env.VERCEL) {
    throw new StoryUploadError(
      StoryUploadErrorCode.STORAGE_FAILED,
      "Story video processing is unavailable right now. Your video has not been published — please try again shortly.",
      503,
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
        mediaProvider: "blob",
        originalFilename: (opts.file.name || "").slice(0, 120),
        createdAt: now,
        readyAt: now,
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
 * Legacy multipart path with Mux available: push the (small) proxied bytes to a
 * fresh Mux direct upload, then record a PROCESSING clip. The webhook publishes.
 */
async function uploadProxyClipToMux(opts: {
  userId: string;
  buffer: Buffer;
  mime: string;
  durationSeconds: number;
  originalFilename: string;
}) {
  const uploadSessionId = `us_${randomBytes(16).toString("hex")}`;
  let muxUploadId = "";
  try {
    const upload = await createMuxDirectUpload({
      uploadSessionId,
      corsOrigin: storyCorsOrigin(),
    });
    muxUploadId = upload.uploadId;
    const put = await fetch(upload.uploadUrl, {
      method: "PUT",
      body: new Uint8Array(opts.buffer),
      headers: { "Content-Type": opts.mime },
      signal: AbortSignal.timeout(55_000),
    });
    if (!put.ok) {
      throw new Error(`Mux upload PUT failed with ${put.status}`);
    }
  } catch (err) {
    console.error("[stories:proxy-mux]", err);
    throw new StoryUploadError(
      StoryUploadErrorCode.STORAGE_FAILED,
      "Story video processing is unavailable right now. Your video has not been published — please try again shortly.",
      503,
    );
  }

  return createProcessingClip({
    userId: opts.userId,
    uploadSessionId,
    muxUploadId,
    size: opts.buffer.length,
    mime: opts.mime,
    durationSeconds: opts.durationSeconds,
    originalFilename: opts.originalFilename,
  });
}

/** CORS origin advertised to Mux for browser direct uploads. */
export function storyCorsOrigin(requestOrigin?: string | null): string {
  const fromRequest = (requestOrigin || "").trim();
  if (/^https?:\/\//i.test(fromRequest)) return fromRequest;
  const appUrl = (process.env.APP_URL || "").trim();
  if (/^https?:\/\//i.test(appUrl)) return appUrl.replace(/\/+$/, "");
  return "*";
}

/** Inserts the PROCESSING row shared by both Mux entry points. Idempotent. */
async function createProcessingClip(opts: {
  userId: string;
  uploadSessionId: string;
  muxUploadId: string;
  size: number;
  mime: string;
  durationSeconds: number;
  originalFilename: string;
  thumbnailUrl?: string;
  thumbnailBlobPathname?: string;
}) {
  const now = new Date();
  try {
    return await prisma.storyClip.create({
      data: {
        userId: opts.userId,
        // Filled in by the Mux webhook once the asset is ready.
        videoUrl: "",
        blobPathname: "",
        thumbnailUrl: opts.thumbnailUrl || "",
        thumbnailBlobPathname: opts.thumbnailBlobPathname || "",
        durationSeconds: opts.durationSeconds,
        fileSizeBytes: opts.size,
        mimeType: opts.mime,
        status: "PROCESSING",
        mediaProvider: "mux",
        muxUploadId: opts.muxUploadId,
        uploadSessionId: opts.uploadSessionId,
        originalFilename: (opts.originalFilename || "").slice(0, 120),
        createdAt: now,
        // Provisional window; replaced with readyAt + 24h by the webhook.
        expiresAt: new Date(now.getTime() + STORY_PROCESSING_TTL_MS),
      },
    });
  } catch (err) {
    const raced = await prisma.storyClip.findUnique({
      where: { uploadSessionId: opts.uploadSessionId },
    });
    if (raced && raced.userId === opts.userId) return raced;
    console.error("[stories:createProcessingClip]", err);
    throw new StoryUploadError(
      StoryUploadErrorCode.DATABASE_FAILED,
      "We couldn’t save this Story. Your video has not been published.",
      500,
    );
  }
}

/**
 * Finalise a browser → Mux direct upload. Creates a PROCESSING clip only —
 * the clip is not public until the `video.asset.ready` webhook arrives.
 * No bitrate, codec or container checks: Mux decides what it can decode.
 */
export async function finalizeStoryFromMux(opts: {
  userId: string;
  uploadSessionId: string;
  muxUploadId: string;
  size?: number | null;
  contentType?: string | null;
  clientDurationSec?: number | null;
  originalFilename?: string | null;
  poster?: File | null;
}) {
  if (opts.userId === "adminsource") {
    throw new StoryUploadError(
      StoryUploadErrorCode.AUTH_FAILED,
      "Administrator accounts cannot post Stories",
      403,
    );
  }

  const uploadSessionId = opts.uploadSessionId.trim().slice(0, 64);
  const muxUploadId = opts.muxUploadId.trim().slice(0, 128);
  if (!uploadSessionId || !muxUploadId) {
    throw new StoryUploadError(
      StoryUploadErrorCode.UNKNOWN,
      "Missing upload session.",
    );
  }

  const existing = await prisma.storyClip.findUnique({
    where: { uploadSessionId },
  });
  if (existing) {
    if (existing.userId !== opts.userId) {
      throw new StoryUploadError(
        StoryUploadErrorCode.OWNERSHIP_FAILED,
        "We couldn’t verify this upload. Please try again.",
        403,
      );
    }
    return existing;
  }

  const mime = resolveStoryMime({
    mime: opts.contentType || "",
    filename: opts.originalFilename || "",
  });
  const size = Number(opts.size || 0);
  // Soft client-reported check only; Mux re-verifies duration on ready.
  const metaError = validateStoryUploadMeta({
    mime,
    size,
    durationSec: Number(opts.clientDurationSec || 0),
    allowUnknownDuration: true,
  });
  if (metaError) {
    throw new StoryUploadError(storyMetaErrorCode(metaError), metaError);
  }

  const clientDur = Number(opts.clientDurationSec);
  const durationSeconds = Math.max(
    1,
    Math.round(Number.isFinite(clientDur) && clientDur > 0 ? clientDur : 1),
  );

  const active = await getActiveDurationSeconds(opts.userId);
  if (active + durationSeconds > MAX_ACTIVE_STORY_SECONDS) {
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

  return createProcessingClip({
    userId: opts.userId,
    uploadSessionId,
    muxUploadId,
    size,
    mime: mime || "video/mp4",
    durationSeconds,
    originalFilename: opts.originalFilename || "",
    thumbnailUrl,
    thumbnailBlobPathname,
  });
}

/**
 * Fetch a limited prefix of a public Blob for duration probing
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
  if (mime.includes("mp4") || mime.includes("quicktime")) {
    const prefix = await probeRemoteMp4Prefix(blobMeta.url || opts.url);
    probed = prefix
      ? probeMp4DurationSeconds(prefix)
      : await probeRemoteMp4Duration(blobMeta.url || opts.url);
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
        mediaProvider: "blob",
        originalFilename: (opts.originalFilename || "").slice(0, 120),
        uploadSessionId,
        createdAt: now,
        readyAt: now,
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

  await deleteMuxAsset(clip.muxAssetId);
  if (clip.blobPathname) {
    await deleteStoredVideoForUser(clip.videoUrl, opts.userId);
  }
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

/**
 * Sweeps expired clips and uploads that never finished processing.
 * Stuck PROCESSING rows past their provisional window are expired too, so an
 * abandoned Mux upload never keeps consuming the owner’s allowance.
 */
export async function expireStoryClips(limit = 200) {
  const now = new Date();
  const expired = await prisma.storyClip.findMany({
    where: {
      status: { in: [...readyStatusList, ...inFlightStatusList, "FAILED"] },
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
      muxAssetId: true,
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
    await deleteMuxAsset(clip.muxAssetId);
    if (clip.blobPathname) {
      await deleteStoredVideoForUser(clip.videoUrl, clip.userId);
    }
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
 * Mux clips stream HLS/MP4 from the Mux CDN; legacy clips stream from the
 * public Blob CDN. Bytes never pass through Next.js — the grant only adds a
 * client refresh window. `activeStoryWhere` already excludes PROCESSING/FAILED.
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
      muxPlaybackId: true,
    },
  });
  if (!clip) return null;

  const grantExpiresAt = new Date(
    Math.min(Date.now() + STORY_PLAYBACK_GRANT_MS, clip.expiresAt.getTime()),
  );
  const base = {
    clipId: clip.id,
    userId: clip.userId,
    expiresAt: grantExpiresAt.toISOString(),
    storyExpiresAt: clip.expiresAt.toISOString(),
    fileSizeBytes: clip.fileSizeBytes,
  };

  if (clip.muxPlaybackId) {
    const hlsUrl = muxHlsUrl(clip.muxPlaybackId);
    const mp4Url = muxMp4Url(clip.muxPlaybackId);
    return {
      ...base,
      playbackUrl: hlsUrl,
      hlsUrl,
      mp4Url,
      contentType: "application/vnd.apple.mpegurl",
      delivery: "mux-cdn" as StoryDelivery,
    };
  }

  return {
    ...base,
    playbackUrl: clip.videoUrl,
    hlsUrl: "",
    mp4Url: clip.videoUrl,
    contentType: clip.mimeType || "video/mp4",
    delivery: "direct-blob-cdn" as StoryDelivery,
  };
}

/* ------------------------------------------------------------------ *
 * Mux webhook transitions. All handlers are idempotent — Mux retries.
 * ------------------------------------------------------------------ */

export type MuxEventRef = {
  assetId?: string | null;
  uploadId?: string | null;
  /** Our uploadSessionId, round-tripped through Mux `passthrough`. */
  passthrough?: string | null;
};

/** Resolve the clip a Mux event belongs to, by asset, upload, or session id. */
async function findClipForMuxEvent(ref: MuxEventRef) {
  if (ref.assetId) {
    const byAsset = await prisma.storyClip.findFirst({
      where: { muxAssetId: ref.assetId },
    });
    if (byAsset) return byAsset;
  }
  if (ref.uploadId) {
    const byUpload = await prisma.storyClip.findUnique({
      where: { muxUploadId: ref.uploadId },
    });
    if (byUpload) return byUpload;
  }
  const session = (ref.passthrough || "").trim();
  if (session) {
    const bySession = await prisma.storyClip.findUnique({
      where: { uploadSessionId: session },
    });
    if (bySession) return bySession;
  }
  return null;
}

/** `video.upload.asset_created` — link the asset id to the pending clip. */
export async function attachMuxAssetToClip(ref: MuxEventRef & { assetId: string }) {
  const clip = await findClipForMuxEvent(ref);
  if (!clip) return null;
  if (clip.muxAssetId === ref.assetId) return clip;
  return prisma.storyClip.update({
    where: { id: clip.id },
    data: { muxAssetId: ref.assetId, mediaProvider: "mux" },
  });
}

export type MuxReadyResult =
  | { outcome: "not_found" }
  | { outcome: "already_ready"; clip: { id: string; userId: string } }
  | { outcome: "ready"; clip: { id: string; userId: string } }
  | { outcome: "rejected"; clip: { id: string; userId: string }; reason: string };

/**
 * `video.asset.ready` — publish the clip. Duration is taken from Mux, never
 * from the client, and a clip longer than the limit is rejected here.
 */
export async function markMuxClipReady(opts: {
  assetId: string;
  passthrough?: string | null;
  playbackId: string;
  durationSec: number;
}): Promise<MuxReadyResult> {
  const clip = await findClipForMuxEvent({
    assetId: opts.assetId,
    passthrough: opts.passthrough,
  });
  if (!clip) return { outcome: "not_found" };
  if (clip.deletedAt) return { outcome: "not_found" };
  if (readyStatusList.includes(clip.status) && clip.muxPlaybackId) {
    return { outcome: "already_ready", clip };
  }

  const durationSeconds = Math.max(1, Math.round(opts.durationSec || 0));
  if (durationSeconds > MAX_STORY_CLIP_SECONDS) {
    await prisma.storyClip.update({
      where: { id: clip.id },
      data: {
        status: "FAILED",
        muxAssetId: opts.assetId,
        processingError: "Clip exceeds the 90 second Story limit.",
      },
    });
    await deleteMuxAsset(opts.assetId);
    return {
      outcome: "rejected",
      clip,
      reason: "Clip exceeds the 90 second Story limit.",
    };
  }

  const readyAt = new Date();
  const updated = await prisma.storyClip.update({
    where: { id: clip.id },
    data: {
      status: "READY",
      mediaProvider: "mux",
      muxAssetId: opts.assetId,
      muxPlaybackId: opts.playbackId,
      videoUrl: muxHlsUrl(opts.playbackId),
      thumbnailUrl: clip.thumbnailUrl || muxThumbnailUrl(opts.playbackId),
      durationSeconds,
      processingError: "",
      readyAt,
      expiresAt: new Date(readyAt.getTime() + STORY_TTL_MS),
    },
  });
  return { outcome: "ready", clip: updated };
}

/** `video.asset.errored` / `video.upload.errored` — mark undecodable input. */
export async function markMuxClipFailed(
  ref: MuxEventRef & { reason?: string },
) {
  const clip = await findClipForMuxEvent(ref);
  if (!clip || clip.status === "FAILED") return clip;
  const updated = await prisma.storyClip.update({
    where: { id: clip.id },
    data: {
      status: "FAILED",
      processingError: (
        ref.reason || "This video could not be processed."
      ).slice(0, 300),
      ...(ref.assetId ? { muxAssetId: ref.assetId } : {}),
    },
  });
  await deleteMuxAsset(ref.assetId || clip.muxAssetId);
  return updated;
}
