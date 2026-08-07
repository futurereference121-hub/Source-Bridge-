/**
 * Controlled TEST ramp for Protected Payments.
 *
 * PAYMENTS_TEST_ALLOWLIST = comma/semicolon/space-separated user IDs or emails.
 * Empty / unset → DENY all ticket create, accept-to-fund, checkout, PI create, and funding.
 * Never open platform-wide just because PAYMENTS_ENABLED is true.
 */

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
  const raw = (process.env.PAYMENTS_TEST_ALLOWLIST || "").replace(/^\uFEFF/, "").trim();
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map(normalizeAllowlistToken)
    .filter(Boolean);
}

/** True when at least one id/email is configured. Empty = closed ramp. */
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
  const list = parseAllowlistRaw();
  if (!list.length) return false;
  const id = normalizeAllowlistToken(user.id || "");
  const email = normalizeAllowlistToken(user.email || "");
  if (id && list.includes(id)) return true;
  if (email && list.includes(email)) return true;
  return false;
}

/**
 * Hard gate for money-path operations. Fail closed.
 * Requires a non-empty allowlist AND every provided identity to match.
 * Error message indicates which identity failed when possible.
 */
export function assertPaymentsTestAllowlisted(
  users: AllowlistIdentity | AllowlistIdentity[],
  opts?: { action?: string; labels?: string[] },
): void {
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
  const configured = isPaymentsTestAllowlistConfigured();
  return {
    allowlistConfigured: configured,
    allowlistEntryCount: getPaymentsTestAllowlistEntryCount(),
    /** Current session may create/accept tickets and fund when payments flags are on. */
    testAccessAllowed: Boolean(user && configured && userMatchesPaymentsAllowlist(user)),
  };
}
