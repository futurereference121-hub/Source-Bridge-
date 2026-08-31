import {
  LIVE_COOLDOWN_MS,
  LIVE_SESSION_DURATION_MS,
  LIVE_VIEWER_TOKEN_TTL_MS,
  LIVE_WAS_LIVE_MS,
} from "./constants";

export function liveEndsAt(startedAt: Date): Date {
  return new Date(startedAt.getTime() + LIVE_SESSION_DURATION_MS);
}

export function liveCooldownUntil(endedAt: Date): Date {
  return new Date(endedAt.getTime() + LIVE_COOLDOWN_MS);
}

export function liveWasLiveUntil(endedAt: Date): Date {
  return new Date(endedAt.getTime() + LIVE_WAS_LIVE_MS);
}

export function remainingLiveMs(endsAt: Date | null | undefined, now: Date): number {
  if (!endsAt) return 0;
  return Math.max(0, endsAt.getTime() - now.getTime());
}

export function isLiveExpired(endsAt: Date | null | undefined, now: Date): boolean {
  return remainingLiveMs(endsAt, now) <= 0;
}

export function isCooldownActive(
  cooldownUntil: Date | null | undefined,
  now: Date,
): boolean {
  if (!cooldownUntil) return false;
  return cooldownUntil.getTime() > now.getTime();
}

export function isWasLiveActive(
  wasLiveUntil: Date | null | undefined,
  now: Date,
): boolean {
  if (!wasLiveUntil) return false;
  return wasLiveUntil.getTime() > now.getTime();
}

/**
 * Viewer tokens must never outlive the session. Cap exp at endsAt.
 */
export function viewerTokenExpiresAt(now: Date, endsAt: Date): Date {
  const raw = new Date(now.getTime() + LIVE_VIEWER_TOKEN_TTL_MS);
  return raw.getTime() <= endsAt.getTime() ? raw : new Date(endsAt.getTime());
}

export function viewerTokenExpUnix(now: Date, endsAt: Date): number {
  return Math.floor(viewerTokenExpiresAt(now, endsAt).getTime() / 1000);
}

/** DVR playhead may not continue past server endsAt, even if the viewer is behind. */
export function dvrPlaybackAllowed(endsAt: Date, now: Date): boolean {
  return now.getTime() < endsAt.getTime();
}
