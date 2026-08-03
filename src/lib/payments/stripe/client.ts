import Stripe from "stripe";
import { getStripeMode, isPaymentsEnabled } from "@/lib/payments/flags";

let stripeSingleton: Stripe | null = null;

export function getStripeSecretKey(): string {
  const mode = getStripeMode();
  if (mode === "LIVE") {
    // Live keys intentionally not used until activation checklist.
    throw Object.assign(new Error("Live Stripe mode is not enabled"), {
      status: 503,
      code: "LIVE_DISABLED",
    });
  }
  return (process.env.STRIPE_SECRET_KEY_TEST || process.env.STRIPE_SECRET_KEY || "").trim();
}

export function getStripePublishableKey(): string {
  return (
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST ||
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
    ""
  ).trim();
}

export function getStripeWebhookSecret(): string {
  return (
    process.env.STRIPE_WEBHOOK_SECRET_TEST ||
    process.env.STRIPE_WEBHOOK_SECRET ||
    ""
  ).trim();
}

export function isStripeConfigured(): boolean {
  return Boolean(getStripeSecretKey()) && isPaymentsEnabled();
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
