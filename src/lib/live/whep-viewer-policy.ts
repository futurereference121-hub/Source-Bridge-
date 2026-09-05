/**
 * Universal WHEP viewer recovery thresholds (capability-based, not device-specific).
 *
 * Documented reasons — tune carefully; short ICE blips are normal in WebRTC.
 */

/** Brief ICE `disconnected` often self-heals; rebuild only after this grace. */
export const WHEP_ICE_DISCONNECT_GRACE_MS = 2_500;

/**
 * Remote video track mute can be transient (keyframe / SFU pause).
 * Rebuild only if still muted after grace.
 */
export const WHEP_TRACK_MUTE_GRACE_MS = 2_000;

/**
 * Connection can stay `connected` while frames freeze (WebKit compositor /
 * decoder stalls). Detect stall after this window with no frame progress.
 */
export const WHEP_RENDER_STALL_MS = 4_000;

/** How often to sample frame health when rVFC is unavailable. */
export const WHEP_FRAME_POLL_MS = 1_000;

/** Continuous healthy playback before resetting the auto-retry counter. */
export const WHEP_STABLE_PLAYBACK_RESET_MS = 8_000;

/** Cap auto-rebuild attempts before surfacing manual RETRY. */
export const WHEP_MAX_AUTO_RETRIES = 5;

/** Base delay for exponential backoff after a failed rebuild. */
export const WHEP_BACKOFF_BASE_MS = 1_000;

/** Cap for exponential backoff. */
export const WHEP_BACKOFF_MAX_MS = 16_000;

/** Jitter fraction applied to backoff (0–30%) to avoid sync storms across viewers. */
export const WHEP_BACKOFF_JITTER = 0.3;

/**
 * Refresh signed playback grant this far before tokenExp.
 * Must NOT tear down a healthy established WHEP session — the signed URL is
 * only needed for the next WHEP POST, not for an active PeerConnection.
 */
export const WHEP_TOKEN_REFRESH_SKEW_MS = 10_000;

/** Minimum wait before scheduling a token refresh timer. */
export const WHEP_TOKEN_REFRESH_MIN_MS = 5_000;

/** Soft UI overlay delay so sub-second blips do not flash "Reconnecting…". */
export const WHEP_RECONNECT_UI_DELAY_MS = 400;

export const WHEP_RECONNECT_MESSAGE = "Reconnecting…";
export const WHEP_FAILED_MESSAGE = "Unable to reconnect to this Live.";
export const WHEP_AUTOPLAY_MESSAGE = "Tap to resume playback";

export type WhepReconnectReason =
  | "initial"
  | "ice_disconnected"
  | "ice_failed"
  | "pc_failed"
  | "track_ended"
  | "track_mute_timeout"
  | "render_stall"
  | "negotiate_error"
  | "offline_recovery"
  | "foreground_unhealthy"
  | "manual_retry"
  | "auth_refresh_rebuild";

/**
 * Bounded exponential backoff with deterministic jitter seed optional.
 * delay = min(max, base * 2^attempt) * (1 + jitter * rand)
 */
export function whepBackoffMs(
  attempt: number,
  rand: () => number = Math.random,
): number {
  const exp = Math.min(
    WHEP_BACKOFF_MAX_MS,
    WHEP_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt),
  );
  const jitter = 1 + WHEP_BACKOFF_JITTER * rand();
  return Math.round(exp * jitter);
}

export function shouldRefreshTokenSoon(
  tokenExpUnix: number,
  nowMs: number,
  skewMs = WHEP_TOKEN_REFRESH_SKEW_MS,
): boolean {
  return tokenExpUnix * 1000 - nowMs <= skewMs;
}

export function tokenRefreshDelayMs(
  tokenExpUnix: number,
  nowMs: number,
): number {
  const refreshAt = tokenExpUnix * 1000 - WHEP_TOKEN_REFRESH_SKEW_MS;
  return Math.max(WHEP_TOKEN_REFRESH_MIN_MS, refreshAt - nowMs);
}
