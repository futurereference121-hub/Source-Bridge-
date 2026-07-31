/** Source Bridge Stories — location clips, not permanent profile videos. */

/** Max length of a single Story clip. */
export const MAX_STORY_CLIP_SECONDS = 90;

/** Total active (unexpired) Story duration per account. */
export const MAX_ACTIVE_STORY_SECONDS = 90 * 60; // 90 minutes

/**
 * Practical ceiling for ≤90s mobile recordings when uploading direct-to-Blob.
 * Must not route this size through the Next.js request body (Vercel ~4.5 MB limit).
 */
export const MAX_STORY_CLIP_BYTES = 100 * 1024 * 1024; // 100 MB

/** Soft server-proxy ceiling — only for local/dev fallback without client Blob tokens. */
export const MAX_STORY_PROXY_BYTES = 4 * 1024 * 1024; // 4 MB

export const STORY_TTL_MS = 24 * 60 * 60 * 1000;

export const ALLOWED_STORY_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

export const STORY_VIDEO_ACCEPT =
  "video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov";

export const STORY_FORMAT_HINT =
  "MP4, MOV, or WebM · max 90 seconds per clip · max 100 MB · up to 90 minutes active total";

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
  videoUrl: string;
  thumbnailUrl: string;
  durationSeconds: number;
  createdAt: string;
  expiresAt: string;
  viewCount?: number;
};

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
  NETWORK: "STORY_NETWORK",
  UNKNOWN: "STORY_UNKNOWN",
} as const;

export type StoryUploadErrorCode =
  (typeof StoryUploadErrorCode)[keyof typeof StoryUploadErrorCode];

export function storyErrorMessage(code: StoryUploadErrorCode, requestId?: string): string {
  switch (code) {
    case StoryUploadErrorCode.FILE_TOO_LARGE:
      return "This video is larger than the current Story upload limit.";
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
      return "We couldn’t store this Story. Your video has not been published.";
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
    case StoryUploadErrorCode.NETWORK:
      return "The upload was interrupted. Check your connection and try again.";
    default:
      return requestId
        ? `We couldn’t upload this Story. Error reference: ${requestId}.`
        : "We couldn’t upload this Story. Please try again.";
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
