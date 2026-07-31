/** Source Bridge Stories — location clips, not permanent profile videos. */

/** Max length of a single Story clip. */
export const MAX_STORY_CLIP_SECONDS = 90;

/** Total active (unexpired) Story duration per account. */
export const MAX_ACTIVE_STORY_SECONDS = 90 * 60; // 90 minutes

/** Practical mobile-friendly upload ceiling for ≤90s clips. */
export const MAX_STORY_CLIP_BYTES = 50 * 1024 * 1024; // 50 MB

export const STORY_TTL_MS = 24 * 60 * 60 * 1000;

export const ALLOWED_STORY_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

export const STORY_VIDEO_ACCEPT =
  "video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov";

export const STORY_FORMAT_HINT =
  "MP4, MOV, or WebM · max 90 seconds per clip · max 50 MB · up to 90 minutes active total";

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
