/**
 * Global Payouts eligibility policy — server-authoritative country / pilot gates.
 * Fail-closed: empty country allowlist ⇒ no GP countries (production default).
 *
 * Connect-unsupported denylist is used only when GLOBAL_PAYOUTS_ENABLED is on,
 * so flag-off behaviour stays identical to today's Connect-only product.
 */

import {
  getStripeMode,
  isGlobalPayoutsEnabled,
  isGlobalPayoutsLiveInitiationEnabled,
  isGlobalPayoutsSandboxEnabled,
  normalizeStripeMode,
  type StripeMode,
} from "@/lib/payments/flags";

function parseList(raw: string | undefined): string[] {
  return String(raw || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** ISO 3166-1 alpha-2 countries allowed for GP (uppercase). Empty = none. */
export function getGlobalPayoutsCountryAllowlist(): string[] {
  return parseList(process.env.GLOBAL_PAYOUTS_COUNTRY_ALLOWLIST).map((c) =>
    c.toUpperCase(),
  );
}

/**
 * Countries where Stripe Connect Express-style onboarding is treated as unavailable
 * for automatic rail routing. Expand via CONNECT_PAYOUT_COUNTRY_DENYLIST.
 * Seed includes TH (verified Connect gap / GP sandbox country).
 * Only consulted when GLOBAL_PAYOUTS_ENABLED — never changes Connect-only mode.
 */
export function getConnectPayoutCountryDenylist(): string[] {
  const fromEnv = parseList(process.env.CONNECT_PAYOUT_COUNTRY_DENYLIST).map((c) =>
    c.toUpperCase(),
  );
  if (fromEnv.length > 0) return fromEnv;
  return ["TH"];
}

/** Optional pilot user ids / emails. Empty = no extra user filter (country still required). */
export function getGlobalPayoutsUserAllowlist(): string[] {
  return parseList(process.env.GLOBAL_PAYOUTS_USER_ALLOWLIST).map((s) =>
    s.toLowerCase(),
  );
}

export function isGlobalPayoutsCountryAllowed(country: string | null | undefined): boolean {
  if (!isGlobalPayoutsEnabled()) return false;
  const code = String(country || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return false;
  const list = getGlobalPayoutsCountryAllowlist();
  if (list.length === 0) return false;
  return list.includes(code);
}

/**
 * Whether Connect is treated as unavailable for this country (GP routing only).
 * When GP master flag is off, always returns false so Connect path is unchanged.
 */
export function isConnectPayoutCountryUnsupported(
  country: string | null | undefined,
): boolean {
  if (!isGlobalPayoutsEnabled()) return false;
  const code = String(country || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return false;
  return getConnectPayoutCountryDenylist().includes(code);
}

export function isGlobalPayoutsUserAllowed(opts: {
  userId: string;
  email?: string | null;
}): boolean {
  if (!isGlobalPayoutsEnabled()) return false;
  const list = getGlobalPayoutsUserAllowlist();
  if (list.length === 0) return true; // country gate alone
  const id = opts.userId.toLowerCase();
  const email = String(opts.email || "").trim().toLowerCase();
  return list.includes(id) || (email.length > 0 && list.includes(email));
}

/**
 * Whether GP money initiation is allowed for this Stripe mode.
 * LIVE always requires live-initiation flag (default off).
 */
export function canInitiateGlobalPayoutsMoney(mode?: StripeMode): boolean {
  if (!isGlobalPayoutsEnabled()) return false;
  const m = normalizeStripeMode(mode ?? getStripeMode());
  if (m === "LIVE") return isGlobalPayoutsLiveInitiationEnabled();
  return isGlobalPayoutsSandboxEnabled();
}

export function assertGlobalPayoutsMoneyAllowed(mode?: StripeMode): void {
  if (canInitiateGlobalPayoutsMoney(mode)) return;
  const m = normalizeStripeMode(mode ?? getStripeMode());
  throw Object.assign(
    new Error(
      m === "LIVE"
        ? "Global Payouts live initiation is disabled."
        : "Global Payouts is not enabled.",
    ),
    {
      status: 503,
      code:
        m === "LIVE"
          ? "GLOBAL_PAYOUTS_LIVE_INITIATION_DISABLED"
          : "GLOBAL_PAYOUTS_DISABLED",
    },
  );
}
