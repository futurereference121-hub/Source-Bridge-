import { handleStripeWebhookPost } from "@/lib/payments/stripe/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Platform Stripe webhook (snapshot events from **Your account**).
 * - payment_intent.succeeded → fund protected txn only when PAYMENTS_ENABLED
 * - Signature verify + idempotency work with flags OFF
 * Env: STRIPE_WEBHOOK_SECRET_TEST (fallback STRIPE_WEBHOOK_SECRET)
 */
export async function POST(req: Request) {
  return handleStripeWebhookPost(req, "platform");
}
