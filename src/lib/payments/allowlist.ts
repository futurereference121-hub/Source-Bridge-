/**
 * TEST-mode payment access gate.
 *
 * Product (pre-Live): when LIVE_PAYMENTS_ENABLED is false and Stripe mode is
 * TEST, ALL otherwise-eligible authenticated users may use TEST payment flows.
 * PAYMENTS_TEST_ALLOWLIST is legacy — an empty list no longer denies access.
 *
 * Normal eligibility (demo/admin/deleted, Connect for sellers receiving funds)
 * still applies outside this module.
 */

import {
  getStripeMode,
  isLivePaymentsEnabled,
} from "@/lib/payments/flags";

export type AllowlistIdentity = {
  id: string;
  email?: string | null;
};

/** Normalize one allowlist token (trim, strip accidental quotes/BOM, lowercase). */
export function normalizeAllowlistToken(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .trim()
    .toLowerCase();
}

function parseAllowlistRaw(): string[] {
  const raw = (process.env.PAYMENTS_TEST_ALLOWLIST || "")
    .replace(/^\uFEFF/, "")
    .trim();
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map(normalizeAllowlistToken)
    .filter(Boolean);
}

/**
 * True when Live is off and Stripe is TEST — open TEST ramp for eligible users.
 * Live money ops remain blocked by LIVE_PAYMENTS_ENABLED / getStripeMode.
 */
export function isPaymentsTestRampOpen(): boolean {
  return !isLivePaymentsEnabled() && getStripeMode() === "TEST";
}

/** Live production: any eligible authenticated user may view/fund (no TEST allowlist). */
export function isPaymentsLiveAccessOpen(): boolean {
  return isLivePaymentsEnabled();
}

/** True when at least one id/email is configured (legacy restrict list). */
export function isPaymentsTestAllowlistConfigured(): boolean {
  return parseAllowlistRaw().length > 0;
}

export function getPaymentsTestAllowlistEntries(): string[] {
  return parseAllowlistRaw();
}

export function getPaymentsTestAllowlistEntryCount(): number {
  return parseAllowlistRaw().length;
}

export function userMatchesPaymentsAllowlist(user: AllowlistIdentity): boolean {
  // Open TEST ramp or Live production: every identity passes allowlist gate checks.
  if (isPaymentsTestRampOpen() || isPaymentsLiveAccessOpen()) return true;
  const list = parseAllowlistRaw();
  if (!list.length) return false;
  const id = normalizeAllowlistToken(user.id || "");
  const email = normalizeAllowlistToken(user.email || "");
  if (id && list.includes(id)) return true;
  if (email && list.includes(email)) return true;
  return false;
}

/**
 * Hard gate for money-path operations in TEST.
 * When the TEST ramp is open (Live off + Stripe TEST), this is a no-op —
 * eligibility / Connect / party checks still apply at call sites.
 * If Live were ever enabled without a separate gate, empty allowlist would deny.
 */
export function assertPaymentsTestAllowlisted(
  users: AllowlistIdentity | AllowlistIdentity[],
  opts?: { action?: string; labels?: string[] },
): void {
  if (isPaymentsTestRampOpen() || isPaymentsLiveAccessOpen()) {
    return;
  }
  const list = Array.isArray(users) ? users : [users];
  if (!isPaymentsTestAllowlistConfigured()) {
    throw Object.assign(
      new Error(
        "Protected Payments test ramp is closed (PAYMENTS_TEST_ALLOWLIST is empty).",
      ),
      { status: 403, code: "PAYMENTS_ALLOWLIST_EMPTY" },
    );
  }
  for (let i = 0; i < list.length; i++) {
    const u = list[i];
    if (!userMatchesPaymentsAllowlist(u)) {
      const label = opts?.labels?.[i] || `party ${i + 1}`;
      throw Object.assign(
        new Error(
          opts?.action
            ? `Not allowed to ${opts.action} — ${label} is not on the payments test allowlist.`
            : `${label} is not on the Protected Payments test allowlist.`,
        ),
        {
          status: 403,
          code: "PAYMENTS_ALLOWLIST_DENIED",
          allowlistParty: label,
        },
      );
    }
  }
}

/** Snapshot for client UI — never include raw allowlist entries publicly. */
export function paymentsAllowlistGateSnapshot(user?: AllowlistIdentity | null) {
  const rampOpen = isPaymentsTestRampOpen();
  const liveOpen = isPaymentsLiveAccessOpen();
  const configured = isPaymentsTestAllowlistConfigured();
  return {
    allowlistConfigured: configured,
    allowlistEntryCount: getPaymentsTestAllowlistEntryCount(),
    /** Open TEST ramp: any authenticated user may use TEST flows when flags are on. */
    testRampOpen: rampOpen,
    /** Live kill switch on — TEST allowlist does not gate session access. */
    liveAccessOpen: liveOpen,
    /** Current session may create/accept tickets and fund when payments flags are on. */
    testAccessAllowed: Boolean(
      user &&
        (rampOpen || liveOpen || (configured && userMatchesPaymentsAllowlist(user))),
    ),
  };
}
