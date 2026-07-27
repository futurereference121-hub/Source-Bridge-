/**
 * Consistent calendar-day keys for rate limits.
 * Default timezone: UTC. Override with APP_TIMEZONE (IANA, e.g. Asia/Bangkok).
 */

const DEFAULT_TZ = "UTC";

export function getAppTimezone(): string {
  return process.env.APP_TIMEZONE || DEFAULT_TZ;
}

/** YYYY-MM-DD in the app timezone. */
export function calendarDayKey(date: Date = new Date(), timeZone?: string): string {
  const tz = timeZone || getAppTimezone();
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // fall through
  }
  return date.toISOString().slice(0, 10);
}

export const DAILY_STATUS_LIMIT = 3;
export const DAILY_OPPORTUNITY_LIMIT = 3;
export const DAILY_MESSAGE_LIMIT = 50;
export const DAILY_SOURCING_LIMIT = 20;
export const STATUS_TTL_MS = 24 * 60 * 60 * 1000;
export const PUBLIC_DISPLAY_MESSAGE_MAX = 160;
export const STATUS_TEXT_MAX = 160;
export const MESSAGE_BODY_MAX = 5000;
export const MESSAGE_ATTACHMENTS_MAX = 5;
export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
