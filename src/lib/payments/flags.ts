/**
 * Protected Payments feature flags.
 * LIVE_PAYMENTS_ENABLED is the Live kill switch (default false).
 * Architecture supports TEST and LIVE; Live stays off until a dedicated activation task.
 */

function envBool(name: string, defaultValue = false): boolean {
  const raw = (process.env[name] || "").trim().toLowerCase();
  if (!raw) return defaultValue;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export type StripeMode = "TEST" | "LIVE";

export function isLivePaymentsEnabled(): boolean {
  return envBool("LIVE_PAYMENTS_ENABLED", false);
}

/**
 * Normalize stored / inbound mode labels. Unknown → TEST (safe default).
 */
export function normalizeStripeMode(raw: string | null | undefined): StripeMode {
  return String(raw || "").trim().toUpperCase() === "LIVE" ? "LIVE" : "TEST";
}

/**
 * Effective Stripe mode for *new* platform activity.
 * LIVE only when LIVE_PAYMENTS_ENABLED is explicitly true.
 * When the kill switch is off, always TEST (even if Live keys exist for readiness).
 */
export function getStripeMode(): StripeMode {
  if (!isLivePaymentsEnabled()) return "TEST";
  return "LIVE";
}

/**
 * Guard for money ops / webhook mutation on an existing financial record.
 * - LIVE records refuse while kill switch is off.
 * - Does NOT require recordMode === getStripeMode(): TEST history stays operable
 *   with the TEST Stripe client even after Live activation.
 */
export function assertStripeModeCompatible(recordMode: string): void {
  const mode = normalizeStripeMode(recordMode);
  if (mode === "LIVE" && !isLivePaymentsEnabled()) {
    throw Object.assign(
      new Error(
        "Stripe mode conflict: LIVE record refused while LIVE_PAYMENTS_ENABLED=false",
      ),
      { status: 409, code: "STRIPE_MODE_CONFLICT" },
    );
  }
}

/**
 * Refuse cross-environment money movement.
 * txn mode + Connect account mode + Stripe client mode must all match.
 */
export function assertMoneyOpEnvironmentMatch(opts: {
  txnStripeMode: string;
  connectStripeMode?: string | null;
  /** Optional explicit client mode (defaults to txn mode). */
  clientStripeMode?: string | null;
}): StripeMode {
  const txnMode = normalizeStripeMode(opts.txnStripeMode);
  assertStripeModeCompatible(txnMode);

  const clientMode = normalizeStripeMode(
    opts.clientStripeMode != null && String(opts.clientStripeMode).trim()
      ? opts.clientStripeMode
      : txnMode,
  );
  if (clientMode !== txnMode) {
    throw Object.assign(
      new Error(
        `Stripe mode conflict: txn is ${txnMode}, client is ${clientMode}`,
      ),
      { status: 409, code: "STRIPE_MODE_CONFLICT" },
    );
  }

  if (
    opts.connectStripeMode != null &&
    String(opts.connectStripeMode).trim() !== ""
  ) {
    const connectMode = normalizeStripeMode(opts.connectStripeMode);
    if (connectMode !== txnMode) {
      throw Object.assign(
        new Error(
          `Stripe mode conflict: txn is ${txnMode}, Connect account is ${connectMode}`,
        ),
        { status: 409, code: "STRIPE_MODE_CONFLICT" },
      );
    }
  }

  return txnMode;
}

export function isPaymentsEnabled(): boolean {
  return envBool("PAYMENTS_ENABLED", false);
}

/**
 * Connect onboarding (Account create + Account Link + status sync).
 * Does NOT enable checkout, PaymentIntents, transfers, refunds by itself.
 */
export function isConnectOnboardingEnabled(): boolean {
  return envBool("CONNECT_ONBOARDING_ENABLED", false);
}

export function isProtectedPaymentsEnabled(): boolean {
  return isPaymentsEnabled() && envBool("PROTECTED_PAYMENTS_ENABLED", false);
}

/**
 * Direct Payment (product name). Storage/legacy flag: INSTANT_PAYMENTS_ENABLED.
 * Prefer DIRECT_PAYMENTS_ENABLED; INSTANT_PAYMENTS_ENABLED remains an alias.
 */
export function isDirectPaymentsEnabled(): boolean {
  if (!isPaymentsEnabled()) return false;
  if (envBool("DIRECT_PAYMENTS_ENABLED", false)) return true;
  return envBool("INSTANT_PAYMENTS_ENABLED", false);
}

/** @deprecated Prefer isDirectPaymentsEnabled — Instant is legacy flag name. */
export function isInstantPaymentsEnabled(): boolean {
  return isDirectPaymentsEnabled();
}

export function isProcurementAdvancesEnabled(): boolean {
  return (
    isProtectedPaymentsEnabled() &&
    envBool("PROCUREMENT_ADVANCES_ENABLED", false)
  );
}

export function isTrackingAutomationEnabled(): boolean {
  return envBool("TRACKING_AUTOMATION_ENABLED", false);
}

export function paymentFlagsSnapshot() {
  // Lazy import pattern avoided — keep flags pure env reads.
  // Allowlist configured status is safe to expose (not the entries themselves).
  const raw = (process.env.PAYMENTS_TEST_ALLOWLIST || "").trim();
  const allowlistConfigured = raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean).length > 0;

  return {
    PAYMENTS_ENABLED: isPaymentsEnabled(),
    CONNECT_ONBOARDING_ENABLED: isConnectOnboardingEnabled(),
    PROTECTED_PAYMENTS_ENABLED: isProtectedPaymentsEnabled(),
    /** Product: Direct Payment. True when DIRECT_ or INSTANT_ flag is on. */
    DIRECT_PAYMENTS_ENABLED: isDirectPaymentsEnabled(),
    /** Legacy alias of DIRECT_PAYMENTS_ENABLED (UI should prefer Direct). */
    INSTANT_PAYMENTS_ENABLED: isDirectPaymentsEnabled(),
    PROCUREMENT_ADVANCES_ENABLED: isProcurementAdvancesEnabled(),
    TRACKING_AUTOMATION_ENABLED: isTrackingAutomationEnabled(),
    /** Kill switch — default false; Live activation is a dedicated task. */
    LIVE_PAYMENTS_ENABLED: isLivePaymentsEnabled(),
    stripeMode: getStripeMode(),
    /**
     * Legacy: whether PAYMENTS_TEST_ALLOWLIST has entries.
     * When Live is off + Stripe TEST, an empty allowlist no longer denies —
     * TEST flows are open to otherwise-eligible authenticated users.
     */
    PAYMENTS_TEST_ALLOWLIST_CONFIGURED: allowlistConfigured,
    /** Live money remains off; TEST ramp is open for eligible accounts. */
    PAYMENTS_TEST_RAMP_OPEN: !isLivePaymentsEnabled() && getStripeMode() === "TEST",
  };
}
