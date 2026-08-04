import Stripe from "stripe";
import { getStripeMode, isPaymentsEnabled } from "@/lib/payments/flags";

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
 * Product features (checkout, public payment UI readiness).
 * Requires flags ON + TEST secret key.
 */
export function isStripeConfigured(): boolean {
  return hasStripeTestSecretKey() && isPaymentsEnabled();
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
 * Preferred charge model: Separate Charges and Transfers.
 * Platform creates PaymentIntent on the platform account, then Transfer to
 * connected account at release (procurement and/or final).
 *
 * Limitation: requires Stripe Connect with transfers capability and a
 * platform country that supports Separate Charges and Transfers. If the
 * platform country cannot support this, do not silently switch to Destination
 * Charges — escalate before architecture change.
 */
export const CHARGE_MODEL = "SEPARATE_CHARGES_AND_TRANSFERS" as const;
