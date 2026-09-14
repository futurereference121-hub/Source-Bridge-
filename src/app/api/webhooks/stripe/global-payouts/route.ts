/**
 * Global Payouts webhook — separate destination from Connect.
 * Thin events for recipients / payout methods / outbound payments.
 *
 * Env: STRIPE_GP_WEBHOOK_SECRET_TEST / STRIPE_GP_WEBHOOK_SECRET_LIVE
 */

import Stripe from "stripe";
import {
  getStripeMode,
  isLivePaymentsEnabled,
  normalizeStripeMode,
  type StripeMode,
} from "@/lib/payments/flags";
import {
  getGlobalPayoutsWebhookSecret,
  handleGlobalPayoutsThinEvent,
} from "@/lib/payments/payout-rail/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function detectModeFromLivemode(livemode: boolean | undefined): StripeMode {
  if (livemode === true) return "LIVE";
  if (livemode === false) return "TEST";
  return getStripeMode();
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature") || "";

  // Try TEST then LIVE secrets (rotation-safe). Never log secrets.
  const modes: StripeMode[] = isLivePaymentsEnabled()
    ? ["TEST", "LIVE"]
    : ["TEST"];

  let event: Stripe.Event | null = null;
  let verifiedMode: StripeMode = "TEST";

  // Minimal Stripe instance for constructEvent only (no money client required).
  const stripe = new Stripe("sk_test_webhook_verify_only", {
    // Type-only pin — constructEvent does not call the API.
    apiVersion: "2025-08-27.basil" as Stripe.LatestApiVersion,
  });

  for (const mode of modes) {
    const secret = getGlobalPayoutsWebhookSecret(mode);
    if (!secret) continue;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, secret);
      verifiedMode = mode;
      break;
    } catch {
      // try next
    }
  }

  if (!event) {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  const livemode =
    typeof (event as { livemode?: boolean }).livemode === "boolean"
      ? (event as { livemode: boolean }).livemode
      : verifiedMode === "LIVE";
  const mode = normalizeStripeMode(detectModeFromLivemode(livemode));

  const related =
    (event as { related_object?: { id?: string; type?: string } }).related_object ||
    (event.data && typeof event.data === "object"
      ? (event.data as { object?: { id?: string; object?: string } }).object
      : null);

  const relatedObjectId =
    related && typeof related === "object"
      ? String(
          (related as { id?: string }).id ||
            (event as { related_object?: { id?: string } }).related_object?.id ||
            "",
        )
      : "";
  const relatedObjectType =
    related && typeof related === "object"
      ? String(
          (related as { type?: string; object?: string }).type ||
            (related as { object?: string }).object ||
            "",
        )
      : "";

  try {
    const result = await handleGlobalPayoutsThinEvent({
      eventId: event.id,
      eventType: event.type,
      stripeMode: mode,
      relatedObjectId,
      relatedObjectType,
      raw: event,
    });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("[webhooks:global-payouts]", {
      eventId: event.id,
      type: event.type,
      message: err instanceof Error ? err.message : "error",
    });
    return Response.json({ error: "handler_failed" }, { status: 500 });
  }
}
