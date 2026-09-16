/**
 * Absolute app origin for emails, Connect return URLs, and auth redirects.
 *
 * On Vercel Preview, never emit Production canonical origins even when
 * APP_URL is accidentally shared with Production.
 */

const PRODUCTION_HOSTS = new Set(["sourcebridge.app", "www.sourcebridge.app"]);

function normalizeOrigin(raw: string): string {
  const trimmed = String(raw || "").trim().replace(/\/$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function hostOf(origin: string): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isProductionCanonicalHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.toLowerCase();
  return PRODUCTION_HOSTS.has(h) || h.endsWith(".sourcebridge.app");
}

function vercelPreviewOrigin(): string | null {
  if (process.env.VERCEL_ENV !== "preview") return null;
  const branch = (process.env.VERCEL_BRANCH_URL || "").trim();
  const deployment = (process.env.VERCEL_URL || "").trim();
  const host = branch || deployment;
  if (!host) return null;
  return normalizeOrigin(host);
}

/**
 * Resolve the public app origin.
 * Preview preference: non-production APP_URL override → VERCEL_BRANCH_URL → VERCEL_URL.
 * Production / local: APP_URL → NEXT_PUBLIC_APP_URL → fallback.
 */
export function getAppUrl(fallback = "http://localhost:3000"): string {
  const previewOrigin = vercelPreviewOrigin();
  const configured = normalizeOrigin(
    process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "",
  );
  const configuredHost = hostOf(configured);

  if (previewOrigin) {
    if (configured && !isProductionCanonicalHost(configuredHost)) {
      return configured;
    }
    return previewOrigin;
  }

  if (configured) return configured;
  return String(fallback || "http://localhost:3000").replace(/\/$/, "");
}

/** Request-aware fallback when env origin is unset (e.g. Connect return URLs). */
export function getAppUrlFromRequest(req: {
  headers: { get(name: string): string | null };
}): string {
  const fromEnv = getAppUrl("");
  if (fromEnv) return fromEnv;
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  return host ? `${proto}://${host}` : "http://localhost:3000";
}
