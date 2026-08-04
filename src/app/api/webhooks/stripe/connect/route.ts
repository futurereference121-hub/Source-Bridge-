import { handleStripeWebhookPost } from "@/lib/payments/stripe/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Connect Stripe webhook for Accounts v2 seller status.
 *
 * Preferred destination: **Your account** + thin events
 * (`v2.core.account.*`, `v2.core.account_link.returned`).
 *
 * Optional companion destination: **Connected accounts** + snapshot
 * `account.updated` (still emitted for v2 Accounts on merchant/recipient
 * config changes) can target this same URL with STRIPE_CONNECT_WEBHOOK_SECRET*.
 *
 * Non-financial: re-sync local charges/payouts/requirements flags.
 * Works while PAYMENTS_ENABLED is false. No funding / transfers here.
 *
 * Env: STRIPE_CONNECT_WEBHOOK_SECRET_TEST
 *      (fallback STRIPE_CONNECT_WEBHOOK_SECRET, then platform webhook secret)
 */
export async function POST(req: Request) {
  return handleStripeWebhookPost(req, "connect");
}
