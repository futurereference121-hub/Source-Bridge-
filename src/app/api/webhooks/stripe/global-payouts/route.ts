/**
 * Global Payouts webhook — separate destination from Connect.
 * Thin events for recipients / payout methods / outbound payments.
 *
 * Env: STRIPE_GP_WEBHOOK_SECRET_TEST / STRIPE_GP_WEBHOOK_SECRET_LIVE
 */

import {
  normalizeStripeMode,
  type StripeMode,
} from "@/lib/payments/flags";
import { handleGlobalPayoutsThinEvent } from "@/lib/payments/payout-rail/events";
import {
  GpWebhookVerifyError,
  isGlobalPayoutsEventDestinationPing,
  verifyGlobalPayoutsThinEvent,
} from "@/lib/payments/payout-rail/webhook-verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  // Exact raw body — do not JSON.parse / re-serialize before verification.
  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature") || "";

  let thinEvent;
  let verifiedMode: StripeMode = "TEST";
  try {
    const verified = verifyGlobalPayoutsThinEvent(rawBody, sig);
    thinEvent = verified.thinEvent;
    verifiedMode = verified.verifiedMode;
  } catch (err) {
    if (err instanceof GpWebhookVerifyError) {
      return Response.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Stripe destination health check — 2xx, zero mutations.
  if (isGlobalPayoutsEventDestinationPing(thinEvent.type)) {
    return Response.json(
      { ok: true, action: "ping_ack", eventId: thinEvent.id },
      { status: 200 },
    );
  }

  const livemode =
    typeof thinEvent.livemode === "boolean" ? thinEvent.livemode : undefined;
  if (
    (livemode === true && verifiedMode !== "LIVE") ||
    (livemode === false && verifiedMode !== "TEST")
  ) {
    return Response.json(
      { error: "Webhook mode does not match the event", code: "GP_WEBHOOK_MODE_MISMATCH" },
      { status: 400 },
    );
  }
  const mode = normalizeStripeMode(livemode === true ? "LIVE" : livemode === false ? "TEST" : verifiedMode);

  const related = thinEvent.related_object;
  const relatedObjectId =
    related && typeof related === "object" ? String(related.id || "") : "";
  const relatedObjectType =
    related && typeof related === "object" ? String(related.type || "") : "";

  try {
    const result = await handleGlobalPayoutsThinEvent({
      eventId: thinEvent.id,
      eventType: thinEvent.type,
      stripeMode: mode,
      relatedObjectId,
      relatedObjectType,
      raw: thinEvent,
    });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "GP_WEBHOOK_MODE_MISMATCH") {
      return Response.json(
        { error: "Webhook mode does not match the stored payout", code },
        { status: 400 },
      );
    }
    console.error("[webhooks:global-payouts]", {
      eventId: thinEvent.id,
      type: thinEvent.type,
      message: err instanceof Error ? err.message : "error",
    });
    return Response.json({ error: "handler_failed" }, { status: 500 });
  }
}
