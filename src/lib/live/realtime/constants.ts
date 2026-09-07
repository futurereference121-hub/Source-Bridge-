/** Ably channel namespace prefix — tokens are scoped to exact session channels only. */
export const LIVE_REALTIME_CHANNEL_PREFIX = "sourcebridge-live:";

/** Ably message name for server-published canonical comments. */
export const LIVE_COMMENT_EVENT = "comment";

/** Short-lived Ably token TTL (ms). */
export const LIVE_REALTIME_TOKEN_TTL_MS = 15 * 60 * 1000;

/** Max plain-text body length for a public Live comment. */
export const LIVE_COMMENT_MAX_LENGTH = 140;

/** Recent comments returned to late joiners (DB — Ably History is unavailable). */
export const LIVE_COMMENT_RECENT_LIMIT = 40;

/** Rolling stack size shown in the viewer overlay. */
export const LIVE_COMMENT_UI_STACK = 8;

/** Per-user comments allowed per LiveSession per rolling minute. */
export const LIVE_COMMENT_RATE_PER_MINUTE = 8;

/** Friendly copy when Ably/engagement is temporarily unavailable. */
export const LIVE_ENGAGEMENT_UNAVAILABLE_MESSAGE =
  "Live comments are temporarily unavailable.";

export const LIVE_COMMENT_TOO_FAST_MESSAGE =
  "You're commenting too quickly. Try again in a moment.";

export const LIVE_COMMENT_REJECTED_MESSAGE =
  "Comment could not be posted. Check length and try again.";
