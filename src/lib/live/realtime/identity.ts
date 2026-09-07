import { createHmac } from "node:crypto";

/**
 * Stable opaque Ably clientId for an authenticated viewer.
 * Same account → same clientId across tabs/devices (presence dedupe).
 * Never embeds raw user id / email / username.
 */
export function liveViewerClientId(userId: string): string {
  const secret =
    (process.env.SESSION_SECRET || "").trim() ||
    (process.env.ABLY_API_KEY || "").trim().slice(0, 32) ||
    "sourcebridge-live-dev";
  const digest = createHmac("sha256", secret)
    .update(`sourcebridge-live-viewer:${userId}`)
    .digest("hex")
    .slice(0, 32);
  return `lv_${digest}`;
}

/**
 * Opaque Ably clientId for the broadcaster (subscribe-only — never enters presence).
 */
export function liveBroadcasterClientId(userId: string): string {
  const secret =
    (process.env.SESSION_SECRET || "").trim() ||
    (process.env.ABLY_API_KEY || "").trim().slice(0, 32) ||
    "sourcebridge-live-dev";
  const digest = createHmac("sha256", secret)
    .update(`sourcebridge-live-broadcaster:${userId}`)
    .digest("hex")
    .slice(0, 32);
  return `lb_${digest}`;
}
