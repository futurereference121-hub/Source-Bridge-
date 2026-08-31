/** Source Bridge Live — V1 timers and labels. Server clock is authoritative. */

export const LIVE_SESSION_DURATION_MS = 30 * 60 * 1000;
export const LIVE_COOLDOWN_MS = 5 * 60 * 1000;
export const LIVE_WAS_LIVE_MS = 24 * 60 * 60 * 1000;
export const LIVE_RECONNECT_GRACE_MS = 25 * 1000;
export const LIVE_PREPARING_TTL_MS = 90 * 1000;
export const LIVE_VIEWER_TOKEN_TTL_MS = 60 * 1000;
export const LIVE_TITLE_MAX = 80;
export const LIVE_LOCATION_MAX = 80;
export const LIVE_INGEST_TIMEOUT_SECONDS = 30;

export const LIVE_STATUSES = [
  "PREPARING",
  "LIVE",
  "ENDED",
  "TERMINATED",
  "FAILED",
] as const;

export type LiveSessionStatus = (typeof LIVE_STATUSES)[number];

export const LIVE_ACTIVE_STATUSES = ["PREPARING", "LIVE"] as const;

export const LIVE_ENDED_REASONS = [
  "BROADCASTER",
  "EXPIRED",
  "ADMIN",
  "FAILED",
  "ABANDONED",
] as const;

export type LiveEndedReason = (typeof LIVE_ENDED_REASONS)[number];

export const LIVE_PROVIDER_CLOUDFLARE = "CLOUDFLARE";

export const LIVE_REPORT_REASONS = [
  "Scam or fraud",
  "Harassment",
  "Dangerous content",
  "Privacy violation",
  "Prohibited item",
  "Misleading location",
  "Other",
] as const;

export type LiveReportReason = (typeof LIVE_REPORT_REASONS)[number];

/** sessionStorage key: capture preview is NOT auto-sent. */
export const LIVE_CAPTURE_DRAFT_KEY = "sb-live-capture-draft";

export const LIVE_CAPTURE_SUGGESTED_TEXT =
  "Hi — I saw this during your Live and wanted to ask if you can source it.";

/** Shown when Cloudflare/provider provisioning fails — raw API text is logged only. */
export const LIVE_START_UNAVAILABLE_MESSAGE =
  "Unable to start Live right now. Please try again.";
