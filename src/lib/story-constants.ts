/** Source Bridge Stories — location clips, not permanent profile videos. */

/** Max length of a single Story clip. */
export const MAX_STORY_CLIP_SECONDS = 90;

/** Total active (unexpired) Story duration per account. */
export const MAX_ACTIVE_STORY_SECONDS = 90 * 60; // 90 minutes

/**
 * Practical ceiling for ≤90s mobile camera originals (HEVC/MOV/high bitrate).
 * Bytes go direct to Mux — never through the Next.js request body.
 */
export const MAX_STORY_CLIP_BYTES = 500 * 1024 * 1024; // 500 MB

/** Soft server-proxy ceiling — only for local/dev fallback without Mux. */
export const MAX_STORY_PROXY_BYTES = 4 * 1024 * 1024; // 4 MB

/**
 * Public Story lifetime after the clip becomes READY (not after upload start).
 * PROCESSING clips use a longer provisional window until Mux finishes.
 */
export const STORY_TTL_MS = 24 * 60 * 60 * 1000;

/** Abandoned upload / stuck PROCESSING cleanup window. */
export const STORY_PROCESSING_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * Status values that may appear on public rings / viewer timelines.
 * READY = Mux-processed delivery. ACTIVE = legacy direct-Blob clips (pre-Mux).
 * PROCESSING never appears on public rings.
 */
export const STORY_READY_STATUSES = ["READY", "ACTIVE"] as const;

/** Short-lived client playback grant window (public Blob URL itself does not expire). */
export const STORY_PLAYBACK_GRANT_MS = 60 * 60 * 1000;

export const ALLOWED_STORY_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

export const STORY_VIDEO_ACCEPT =
  "video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov";

export const STORY_FORMAT_HINT =
  "Up to 90 seconds. Videos are optimised automatically.";

export const STORY_PRIVACY_NOTICE =
  "Stories are visible on your public Source Bridge profile and expire after 24 hours.";

export const STORY_REPORT_REASONS = [
  "Scam or fraud",
  "Prohibited item",
  "Harassment",
  "Dangerous content",
  "Privacy violation",
  "Misleading location",
  "Other",
] as const;

export type StoryReportReason = (typeof STORY_REPORT_REASONS)[number];

export type StoryClipPublic = {
  id: string;
  userId: string;
  /** HLS manifest for Mux clips, public Blob URL for legacy clips. */
  videoUrl: string;
  thumbnailUrl: string;
  durationSeconds: number;
  createdAt: string;
  expiresAt: string;
  viewCount?: number;
  /** Present on owner-facing lists so PROCESSING / FAILED clips can be labelled. */
  status?: string;
  hlsUrl?: string;
  mp4Url?: string;
  delivery?: StoryDelivery;
};

export type StoryDelivery = "mux-cdn" | "direct-blob-cdn";

/** Owner-facing label for a clip that is not yet publicly playable. */
export function storyStatusLabel(status?: string): string {
  switch (status) {
    case "PROCESSING":
    case "UPLOADING":
      return "Processing…";
    case "FAILED":
      return "Processing failed";
    default:
      return "";
  }
}

/** Safe machine-readable codes for Story upload failures (no secrets). */
export const StoryUploadErrorCode = {
  FILE_TOO_LARGE: "STORY_FILE_TOO_LARGE",
  UNSUPPORTED_FORMAT: "STORY_UNSUPPORTED_FORMAT",
  UNSUPPORTED_CODEC: "STORY_UNSUPPORTED_CODEC",
  DURATION_INVALID: "STORY_DURATION_INVALID",
  DURATION_UNKNOWN: "STORY_DURATION_UNKNOWN",
  QUOTA_EXCEEDED: "STORY_QUOTA_EXCEEDED",
  STORAGE_FAILED: "STORY_STORAGE_FAILED",
  DATABASE_FAILED: "STORY_DATABASE_FAILED",
  UPLOAD_TIMEOUT: "STORY_UPLOAD_TIMEOUT",
  AUTH_FAILED: "STORY_AUTH_FAILED",
  REQUEST_TOO_LARGE: "STORY_REQUEST_TOO_LARGE",
  OWNERSHIP_FAILED: "STORY_OWNERSHIP_FAILED",
  BITRATE_TOO_HIGH: "STORY_BITRATE_TOO_HIGH",
  NOT_FAST_START: "STORY_NOT_FAST_START",
  NETWORK: "STORY_NETWORK",
  UNKNOWN: "STORY_UNKNOWN",
} as const;

/** Safe machine-readable codes for Story playback failures (no secrets / URLs). */
export const StoryPlaybackErrorCode = {
  URL_EXPIRED: "STORY_URL_EXPIRED",
  MEDIA_NOT_READY: "STORY_MEDIA_NOT_READY",
  MEDIA_NOT_FOUND: "STORY_MEDIA_NOT_FOUND",
  MEDIA_UNSUPPORTED: "STORY_MEDIA_UNSUPPORTED",
  STREAM_FAILED: "STORY_STREAM_FAILED",
  NETWORK_INTERRUPTED: "STORY_NETWORK_INTERRUPTED",
  AUTHORISATION_FAILED: "STORY_AUTHORISATION_FAILED",
  PROCESSING_FAILED: "STORY_PROCESSING_FAILED",
  UNKNOWN: "STORY_PLAYBACK_UNKNOWN",
} as const;

export type StoryPlaybackErrorCode =
  (typeof StoryPlaybackErrorCode)[keyof typeof StoryPlaybackErrorCode];

export type StoryUploadErrorCode =
  (typeof StoryUploadErrorCode)[keyof typeof StoryUploadErrorCode];

export function storyErrorMessage(code: StoryUploadErrorCode, requestId?: string): string {
  switch (code) {
    case StoryUploadErrorCode.FILE_TOO_LARGE:
      return "This video is larger than the 500 MB Story upload limit.";
    case StoryUploadErrorCode.UNSUPPORTED_FORMAT:
      return "This video format is not supported. Try MP4, MOV or WebM.";
    case StoryUploadErrorCode.UNSUPPORTED_CODEC:
      return "This video uses a codec that cannot yet be processed. Try recording in a more compatible format.";
    case StoryUploadErrorCode.DURATION_INVALID:
      return "Each Story clip can be up to 90 seconds.";
    case StoryUploadErrorCode.DURATION_UNKNOWN:
      return "We could not verify this video’s length. Try another clip or a shorter recording.";
    case StoryUploadErrorCode.QUOTA_EXCEEDED:
      return "You have reached your 90-minute active Story limit.";
    case StoryUploadErrorCode.STORAGE_FAILED:
      return "Story video processing is unavailable right now. Your video has not been published — please try again shortly.";
    case StoryUploadErrorCode.DATABASE_FAILED:
      return "We couldn’t save this Story. Your video has not been published.";
    case StoryUploadErrorCode.UPLOAD_TIMEOUT:
      return "The upload timed out. Check your connection and try again.";
    case StoryUploadErrorCode.AUTH_FAILED:
      return "Your session expired. Sign in again and retry.";
    case StoryUploadErrorCode.REQUEST_TOO_LARGE:
      return "This video is too large to upload through the previous method. Retry to use the updated uploader.";
    case StoryUploadErrorCode.OWNERSHIP_FAILED:
      return "We couldn’t verify this upload. Please try again.";
    case StoryUploadErrorCode.BITRATE_TOO_HIGH:
      return "This video is too high-quality for reliable Story playback. Re-export at a lower bitrate (H.264 MP4, roughly 1080p or less) and try again.";
    case StoryUploadErrorCode.NOT_FAST_START:
      return "This MP4 isn’t web-optimised (fast-start). Re-export with “fast start” / “web optimized” enabled and try again.";
    case StoryUploadErrorCode.NETWORK:
      return "The upload was interrupted. Check your connection and try again.";
    default:
      return requestId
        ? `We couldn’t upload this Story. Error reference: ${requestId}.`
        : "We couldn’t upload this Story. Please try again.";
  }
}

export function storyPlaybackErrorMessage(
  code: StoryPlaybackErrorCode,
  requestId?: string,
): string {
  switch (code) {
    case StoryPlaybackErrorCode.URL_EXPIRED:
      return "This Story link expired. Retrying…";
    case StoryPlaybackErrorCode.MEDIA_NOT_READY:
      return "This Story is still processing. Try again in a moment.";
    case StoryPlaybackErrorCode.MEDIA_NOT_FOUND:
      return "This Story is no longer available.";
    case StoryPlaybackErrorCode.MEDIA_UNSUPPORTED:
      return "This clip can’t be played on this device.";
    case StoryPlaybackErrorCode.STREAM_FAILED:
      return "Playback failed. Check your connection and retry.";
    case StoryPlaybackErrorCode.NETWORK_INTERRUPTED:
      return "Connection interrupted. Retry to continue.";
    case StoryPlaybackErrorCode.AUTHORISATION_FAILED:
      return "You don’t have access to this Story.";
    case StoryPlaybackErrorCode.PROCESSING_FAILED:
      return "This Story failed processing and can’t be played.";
    default:
      return requestId
        ? `Playback failed. Error reference: ${requestId}.`
        : "Playback failed. Please try again.";
  }
}

/** Resolve MIME from browser type and/or filename extension. */
export function resolveStoryMime(opts: {
  mime?: string | null;
  filename?: string | null;
}): string {
  const raw = (opts.mime || "").trim().toLowerCase();
  if (raw === "video/jpg") return "video/mp4";
  if (ALLOWED_STORY_VIDEO_TYPES.has(raw)) return raw;
  const name = (opts.filename || "").toLowerCase();
  if (name.endsWith(".mov")) return "video/quicktime";
  if (name.endsWith(".webm")) return "video/webm";
  if (name.endsWith(".mp4") || name.endsWith(".m4v")) return "video/mp4";
  return raw || "";
}
