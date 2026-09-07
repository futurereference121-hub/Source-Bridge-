import {
  LIVE_REALTIME_CHANNEL_PREFIX,
} from "./constants";

/** Exact Ably channel for one LiveSession. Never a wildcard. */
export function liveRealtimeChannelName(liveSessionId: string): string {
  const id = (liveSessionId || "").trim();
  if (!id || id.includes(":") || id.includes("*")) {
    throw new Error("Invalid Live session id for realtime channel");
  }
  return `${LIVE_REALTIME_CHANNEL_PREFIX}${id}`;
}

export function parseLiveSessionIdFromChannel(
  channelName: string,
): string | null {
  if (!channelName.startsWith(LIVE_REALTIME_CHANNEL_PREFIX)) return null;
  const id = channelName.slice(LIVE_REALTIME_CHANNEL_PREFIX.length);
  if (!id || id.includes(":") || id.includes("*")) return null;
  return id;
}
