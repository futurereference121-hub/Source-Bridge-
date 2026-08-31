/**
 * Source Bridge Live feature flag.
 * Default safe: off unless LIVE_STREAMING_ENABLED is explicitly true AND
 * Cloudflare Stream credentials are present (or LIVE_STREAM_PROVIDER=mock in tests).
 * Never show a broken Go Live button when misconfigured.
 */

function envBool(name: string, defaultValue = false): boolean {
  const raw = (process.env[name] || "").trim().toLowerCase();
  if (!raw) return defaultValue;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function isLiveStreamingEnabled(): boolean {
  return envBool("LIVE_STREAMING_ENABLED", false);
}

export function isLiveStreamMockProvider(): boolean {
  return (process.env.LIVE_STREAM_PROVIDER || "").trim().toLowerCase() === "mock";
}

export function isCloudflareStreamConfigured(): boolean {
  const accountId = (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const token = (process.env.CLOUDFLARE_API_TOKEN || "").trim();
  const customer = (process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE || "").trim();
  const kid = (process.env.CLOUDFLARE_STREAM_SIGNING_KEY_ID || "").trim();
  const pem = (process.env.CLOUDFLARE_STREAM_SIGNING_KEY_PEM || "").trim();
  const jwk = (process.env.CLOUDFLARE_STREAM_SIGNING_KEY_JWK || "").trim();
  return Boolean(accountId && token && customer && kid && (pem || jwk));
}

/** Feature is usable in this process — no partial/broken Go Live. */
export function isLiveStreamingAvailable(): boolean {
  if (!isLiveStreamingEnabled()) return false;
  if (isLiveStreamMockProvider()) return true;
  return isCloudflareStreamConfigured();
}

export function liveStreamingPublicStatus(): {
  available: boolean;
  enabled: boolean;
  configured: boolean;
} {
  const enabled = isLiveStreamingEnabled();
  const configured =
    isLiveStreamMockProvider() || isCloudflareStreamConfigured();
  return {
    enabled,
    configured,
    available: enabled && configured,
  };
}
