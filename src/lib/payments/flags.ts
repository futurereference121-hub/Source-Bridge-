/**
 * Protected Payments feature flags.
 * LIVE_PAYMENTS_ENABLED must remain false until legal + Connect go-live checklist.
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

/** Effective Stripe mode — LIVE only when explicitly enabled AND live keys present. */
export function getStripeMode(): StripeMode {
  if (isLivePaymentsEnabled()) {
    // Hard refuse: live mode is not activated for Source Bridge yet.
    // Even if someone sets LIVE_PAYMENTS_ENABLED=true, we stay on TEST until
    // the activation checklist is completed in code review.
    return "TEST";
  }
  return "TEST";
}

export function isPaymentsEnabled(): boolean {
  return envBool("PAYMENTS_ENABLED", false);
}

/**
 * TEST-only Connect onboarding (Account create + Account Link + status sync).
 * Does NOT enable checkout, PaymentIntents, transfers, refunds, or live mode.
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

export function assertStripeModeCompatible(recordMode: string): void {
  const active = getStripeMode();
  if (recordMode && recordMode !== active) {
    throw Object.assign(
      new Error(
        `Stripe mode conflict: record is ${recordMode}, platform is ${active}`,
      ),
      { status: 409, code: "STRIPE_MODE_CONFLICT" },
    );
  }
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
    /** Hard-coded off while activation checklist incomplete (matches getStripeMode). */
    LIVE_PAYMENTS_ENABLED: false,
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
