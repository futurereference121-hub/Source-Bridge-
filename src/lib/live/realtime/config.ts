/**
 * Ably realtime availability — orthogonal to Cloudflare Live video.
 * Missing Ably must not disable WHIP/WHEP playback.
 */

export function getAblyApiKey(): string | null {
  const key = (process.env.ABLY_API_KEY || "").trim();
  return key || null;
}

export function isAblyConfigured(): boolean {
  return Boolean(getAblyApiKey());
}

export function liveRealtimePublicStatus(): {
  configured: boolean;
  available: boolean;
} {
  const configured = isAblyConfigured();
  return {
    configured,
    available: configured,
  };
}
