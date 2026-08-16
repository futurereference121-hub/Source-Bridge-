import Stripe from "stripe";
import {
  getStripeMode,
  isLivePaymentsEnabled,
  isPaymentsEnabled,
} from "@/lib/payments/flags";

let stripeSingleton: Stripe | null = null;

function trimEnv(name: string): string {
  return (process.env[name] || "").trim();
}

export function getStripeSecretKey(): string {
  const mode = getStripeMode();
  if (mode === "LIVE") {
    // Live keys intentionally not used until activation checklist.
    throw Object.assign(new Error("Live Stripe mode is not enabled"), {
      status: 503,
      code: "LIVE_DISABLED",
    });
  }
  return (trimEnv("STRIPE_SECRET_KEY_TEST") || trimEnv("STRIPE_SECRET_KEY")).trim();
}

/** True when a Stripe TEST secret key is present (independent of PAYMENTS_ENABLED). */
export function hasStripeTestSecretKey(): boolean {
  const key =
    trimEnv("STRIPE_SECRET_KEY_TEST") || trimEnv("STRIPE_SECRET_KEY");
  return key.startsWith("sk_test_");
}

/** True when a live secret key is present (always refused while LIVE stays off). */
export function hasStripeLiveSecretKey(): boolean {
  const key =
    trimEnv("STRIPE_SECRET_KEY_TEST") || trimEnv("STRIPE_SECRET_KEY");
  return key.startsWith("sk_live_");
}

export function getStripePublishableKey(): string {
  return (
    trimEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST") ||
    trimEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY")
  );
}

/** Platform / payment-intent destination secrets (TEST first, then legacy). */
export function getStripeWebhookSecrets(): string[] {
  return [
    trimEnv("STRIPE_WEBHOOK_SECRET_TEST"),
    trimEnv("STRIPE_WEBHOOK_SECRET"),
  ].filter(Boolean);
}

export function getStripeWebhookSecret(): string {
  return getStripeWebhookSecrets()[0] || "";
}

/** Connect destination secrets (thin Your-account and/or snapshot Connected-accounts). */
export function getStripeConnectWebhookSecrets(): string[] {
  return [
    trimEnv("STRIPE_CONNECT_WEBHOOK_SECRET_TEST"),
    trimEnv("STRIPE_CONNECT_WEBHOOK_SECRET"),
  ].filter(Boolean);
}

export function getStripeConnectWebhookSecret(): string {
  return getStripeConnectWebhookSecrets()[0] || "";
}

/**
 * Product features (checkout, PaymentIntent, transfers, public purchase readiness).
 * Requires PAYMENTS_ENABLED + TEST secret key. Independent of Connect onboarding.
 */
export function isStripeConfigured(): boolean {
  return hasStripeTestSecretKey() && isPaymentsEnabled();
}

/**
 * TEST Connect onboarding / account-link / status APIs.
 * Requires CONNECT_ONBOARDING_ENABLED + TEST secret key.
 * Does NOT require PAYMENTS_ENABLED (and never allows live keys / live mode).
 */
export function isConnectOnboardingApiReady(): boolean {
  if (isLivePaymentsEnabled()) return false;
  if (getStripeMode() !== "TEST") return false;
  if (hasStripeLiveSecretKey()) return false;
  // TEST: any eligible account may start seller onboarding when TEST keys exist.
  // CONNECT_ONBOARDING_ENABLED remains a Live-era switch; do not require it in TEST.
  return hasStripeTestSecretKey();
}

/**
 * Webhook routes may verify signatures when a signing secret exists even if
 * PAYMENTS_ENABLED is false. API sync after verify still needs a test key.
 */
export function isStripeWebhookSecretConfigured(kind: "platform" | "connect" = "platform"): boolean {
  if (kind === "connect") {
    return (
      getStripeConnectWebhookSecrets().length > 0 ||
      getStripeWebhookSecrets().length > 0
    );
  }
  return getStripeWebhookSecrets().length > 0;
}

export function getStripe(): Stripe {
  const key = getStripeSecretKey();
  if (!key) {
    throw Object.assign(new Error("Stripe is not configured (TEST keys required)"), {
      status: 503,
      code: "STRIPE_NOT_CONFIGURED",
    });
  }
  if (!key.startsWith("sk_test_")) {
    throw Object.assign(
      new Error("Only Stripe TEST secret keys are accepted while LIVE_PAYMENTS_ENABLED=false"),
      { status: 503, code: "STRIPE_LIVE_KEY_REFUSED" },
    );
  }
  if (!stripeSingleton) {
    stripeSingleton = new Stripe(key, {
      typescript: true,
    });
  }
  return stripeSingleton;
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
