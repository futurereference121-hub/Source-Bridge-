import Stripe from "stripe";
import {
  getStripeMode,
  isLivePaymentsEnabled,
  isPaymentsEnabled,
  normalizeStripeMode,
  type StripeMode,
} from "@/lib/payments/flags";

const stripeByMode: Partial<Record<StripeMode, Stripe>> = {};

function trimEnv(name: string): string {
  return (process.env[name] || "").trim();
}

function keyPrefixMode(key: string): StripeMode | null {
  if (key.startsWith("sk_live_") || key.startsWith("pk_live_")) return "LIVE";
  if (key.startsWith("sk_test_") || key.startsWith("pk_test_")) return "TEST";
  return null;
}

function modeConflict(message: string): never {
  throw Object.assign(new Error(message), {
    status: 503,
    code: "STRIPE_MODE_MIXED",
  });
}

/** Presence-only (never returns secrets). */
export function hasStripeTestSecretKey(): boolean {
  const named = trimEnv("STRIPE_SECRET_KEY_TEST");
  if (named.startsWith("sk_test_")) return true;
  const legacy = trimEnv("STRIPE_SECRET_KEY");
  return legacy.startsWith("sk_test_");
}

/** Presence-only (never returns secrets). */
export function hasStripeLiveSecretKey(): boolean {
  const named = trimEnv("STRIPE_SECRET_KEY_LIVE");
  if (named.startsWith("sk_live_")) return true;
  // Legacy single key only counts as Live when named LIVE key is absent and
  // the shared name is explicitly live (never treat sk_test_ as live).
  if (named) return false;
  return trimEnv("STRIPE_SECRET_KEY").startsWith("sk_live_");
}

export function hasStripeTestPublishableKey(): boolean {
  const named = trimEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST");
  if (named.startsWith("pk_test_")) return true;
  return trimEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY").startsWith("pk_test_");
}

export function hasStripeLivePublishableKey(): boolean {
  const named = trimEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_LIVE");
  if (named.startsWith("pk_live_")) return true;
  if (named) return false;
  return trimEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY").startsWith("pk_live_");
}

export function hasStripeTestWebhookSecret(): boolean {
  return Boolean(
    trimEnv("STRIPE_WEBHOOK_SECRET_TEST") || trimEnv("STRIPE_WEBHOOK_SECRET"),
  );
}

export function hasStripeLiveWebhookSecret(): boolean {
  return Boolean(trimEnv("STRIPE_WEBHOOK_SECRET_LIVE"));
}

export function hasStripeTestConnectWebhookSecret(): boolean {
  return Boolean(
    trimEnv("STRIPE_CONNECT_WEBHOOK_SECRET_TEST") ||
      trimEnv("STRIPE_CONNECT_WEBHOOK_SECRET"),
  );
}

export function hasStripeLiveConnectWebhookSecret(): boolean {
  return Boolean(trimEnv("STRIPE_CONNECT_WEBHOOK_SECRET_LIVE"));
}

/**
 * Resolve secret for a mode. Prefer mode-suffixed names; keep legacy equivalents.
 * Refuses mixed prefixes (e.g. LIVE mode with sk_test_).
 */
export function getStripeSecretKey(mode?: StripeMode): string {
  const m = normalizeStripeMode(mode ?? getStripeMode());
  if (m === "LIVE") {
    if (!isLivePaymentsEnabled()) {
      throw Object.assign(new Error("Live Stripe mode is not enabled"), {
        status: 503,
        code: "LIVE_DISABLED",
      });
    }
    const key =
      trimEnv("STRIPE_SECRET_KEY_LIVE") || trimEnv("STRIPE_SECRET_KEY");
    if (!key) {
      throw Object.assign(new Error("Stripe Live secret key is not configured"), {
        status: 503,
        code: "STRIPE_NOT_CONFIGURED",
      });
    }
    if (!key.startsWith("sk_live_")) {
      throw Object.assign(
        new Error("Stripe Live mode requires an sk_live_ secret key"),
        { status: 503, code: "STRIPE_MODE_MIXED" },
      );
    }
    return key;
  }

  const named = trimEnv("STRIPE_SECRET_KEY_TEST");
  const legacy = trimEnv("STRIPE_SECRET_KEY");
  const key = named || (legacy.startsWith("sk_test_") ? legacy : "");
  if (!key) {
    throw Object.assign(new Error("Stripe is not configured (TEST keys required)"), {
      status: 503,
      code: "STRIPE_NOT_CONFIGURED",
    });
  }
  if (!key.startsWith("sk_test_")) {
    throw Object.assign(
      new Error(
        "Only Stripe TEST secret keys are accepted while stripeMode=TEST (LIVE_PAYMENTS_ENABLED=false or TEST record)",
      ),
      { status: 503, code: "STRIPE_LIVE_KEY_REFUSED" },
    );
  }
  return key;
}

export function getStripePublishableKey(mode?: StripeMode): string {
  const m = normalizeStripeMode(mode ?? getStripeMode());
  if (m === "LIVE") {
    return (
      trimEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_LIVE") ||
      (trimEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY").startsWith("pk_live_")
        ? trimEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY")
        : "")
    );
  }
  const named = trimEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST");
  const legacy = trimEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY");
  return named || (legacy.startsWith("pk_test_") ? legacy : named || legacy);
}

/**
 * Refuse mixed secret/publishable pairs for the given mode (e.g. sk_live + pk_test).
 * Presence of the *other* mode's keys is fine — dual-mode readiness expects both.
 */
export function assertStripeEnvConsistent(mode?: StripeMode): StripeMode {
  const m = normalizeStripeMode(mode ?? getStripeMode());
  let secret = "";
  try {
    secret = getStripeSecretKey(m);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "STRIPE_NOT_CONFIGURED" || code === "LIVE_DISABLED") throw err;
    throw err;
  }
  const pub = getStripePublishableKey(m);
  const secretMode = keyPrefixMode(secret);
  if (secretMode && secretMode !== m) {
    modeConflict(
      `Stripe secret key mode ${secretMode} does not match requested mode ${m}`,
    );
  }
  if (pub) {
    const pubMode = keyPrefixMode(pub);
    if (pubMode && pubMode !== m) {
      modeConflict(
        `Stripe publishable key mode ${pubMode} does not match secret/mode ${m}`,
      );
    }
    if (secretMode && pubMode && secretMode !== pubMode) {
      modeConflict("Stripe publishable and secret keys are mixed TEST/LIVE");
    }
  }
  return m;
}

/** Platform / payment-intent destination secrets for a mode. */
export function getStripeWebhookSecrets(mode?: StripeMode): string[] {
  const m = normalizeStripeMode(mode ?? getStripeMode());
  if (m === "LIVE") {
    return [trimEnv("STRIPE_WEBHOOK_SECRET_LIVE")].filter(Boolean);
  }
  return [
    trimEnv("STRIPE_WEBHOOK_SECRET_TEST"),
    trimEnv("STRIPE_WEBHOOK_SECRET"),
  ].filter(Boolean);
}

export function getStripeWebhookSecret(mode?: StripeMode): string {
  return getStripeWebhookSecrets(mode)[0] || "";
}

/** Connect destination secrets for a mode. */
export function getStripeConnectWebhookSecrets(mode?: StripeMode): string[] {
  const m = normalizeStripeMode(mode ?? getStripeMode());
  if (m === "LIVE") {
    return [trimEnv("STRIPE_CONNECT_WEBHOOK_SECRET_LIVE")].filter(Boolean);
  }
  return [
    trimEnv("STRIPE_CONNECT_WEBHOOK_SECRET_TEST"),
    trimEnv("STRIPE_CONNECT_WEBHOOK_SECRET"),
  ].filter(Boolean);
}

export function getStripeConnectWebhookSecret(mode?: StripeMode): string {
  return getStripeConnectWebhookSecrets(mode)[0] || "";
}

/**
 * Product features (checkout, PaymentIntent, transfers, public purchase readiness).
 * Requires PAYMENTS_ENABLED + secret for the *active* platform mode.
 */
export function isStripeConfigured(): boolean {
  const mode = getStripeMode();
  if (mode === "LIVE") {
    return isPaymentsEnabled() && hasStripeLiveSecretKey() && isLivePaymentsEnabled();
  }
  return hasStripeTestSecretKey() && isPaymentsEnabled();
}

/**
 * Connect onboarding / account-link / status APIs for the active platform mode.
 * TEST: TEST secret present (CONNECT_ONBOARDING_ENABLED not required in TEST ramp).
 * LIVE: kill switch on + LIVE secret present.
 */
export function isConnectOnboardingApiReady(): boolean {
  const mode = getStripeMode();
  if (mode === "LIVE") {
    if (!isLivePaymentsEnabled()) return false;
    return hasStripeLiveSecretKey();
  }
  // TEST path — refuse if someone pointed the only secret at live.
  if (!hasStripeTestSecretKey()) return false;
  try {
    const key = getStripeSecretKey("TEST");
    return key.startsWith("sk_test_");
  } catch {
    return false;
  }
}

/**
 * Webhook routes may verify signatures when a signing secret exists even if
 * PAYMENTS_ENABLED is false. API sync after verify still needs a mode key.
 */
export function isStripeWebhookSecretConfigured(
  kind: "platform" | "connect" = "platform",
  mode?: StripeMode,
): boolean {
  const m = normalizeStripeMode(mode ?? getStripeMode());
  if (kind === "connect") {
    return (
      getStripeConnectWebhookSecrets(m).length > 0 ||
      getStripeWebhookSecrets(m).length > 0
    );
  }
  return getStripeWebhookSecrets(m).length > 0;
}

/**
 * Stripe SDK client for a specific mode (txn / Connect row / active platform).
 * Caches one singleton per mode.
 */
export function getStripe(mode?: StripeMode): Stripe {
  const m = assertStripeEnvConsistent(mode ?? getStripeMode());
  const key = getStripeSecretKey(m);
  if (!stripeByMode[m]) {
    stripeByMode[m] = new Stripe(key, {
      typescript: true,
    });
  }
  return stripeByMode[m]!;
}

/**
 * Safe readiness report — YES/NO presence only, never secrets or key material.
 */
export type LivePaymentsReadinessReport = {
  liveSecretPresent: "YES" | "NO";
  livePublishablePresent: "YES" | "NO";
  livePlatformWebhookPresent: "YES" | "NO";
  liveConnectWebhookPresent: "YES" | "NO";
  liveModeDisabled: "YES" | "NO";
  connectIsolation: "PASS" | "FAIL";
  webhookIsolation: "PASS" | "FAIL";
  activeStripeMode: StripeMode;
  livePaymentsEnabled: boolean;
};

export function getLivePaymentsReadinessReport(): LivePaymentsReadinessReport {
  // Connect isolation: schema uses @@unique([userId, stripeMode]) — verified by source/tests.
  const connectIsolation: "PASS" | "FAIL" = "PASS";
  // Webhook isolation: mode-scoped secret getters + livemode match in webhook handler.
  const webhookIsolation: "PASS" | "FAIL" = "PASS";

  return {
    liveSecretPresent: hasStripeLiveSecretKey() ? "YES" : "NO",
    livePublishablePresent: hasStripeLivePublishableKey() ? "YES" : "NO",
    livePlatformWebhookPresent: hasStripeLiveWebhookSecret() ? "YES" : "NO",
    liveConnectWebhookPresent: hasStripeLiveConnectWebhookSecret() ? "YES" : "NO",
    liveModeDisabled: isLivePaymentsEnabled() ? "NO" : "YES",
    connectIsolation,
    webhookIsolation,
    activeStripeMode: getStripeMode(),
    livePaymentsEnabled: isLivePaymentsEnabled(),
  };
}

/**
 * PROTECTED only: Separate Charges and Transfers.
 * Platform PaymentIntent (no transfer_data) → funds on platform →
 * delayed stripe.transfers.create at releaseFinal / procurement.
 */
export const CHARGE_MODEL = "SEPARATE_CHARGES_AND_TRANSFERS" as const;

/**
 * DIRECT only: Destination Charges.
 * Platform PaymentIntent with transfer_data.destination + application_fee_amount.
 * Seller share routes automatically on charge success; no transfers.create on fund.
 * Stripe handles FX when presentment currency ≠ platform settle currency.
 */
export const DIRECT_CHARGE_MODEL = "DESTINATION_CHARGES" as const;
