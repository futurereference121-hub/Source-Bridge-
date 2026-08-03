import { prisma } from "@/lib/db";
import { getStripe, getStripeWebhookSecret, isStripeConfigured } from "@/lib/payments/stripe/client";
import { getStripeMode } from "@/lib/payments/flags";
import { markTxnFundedFromWebhook } from "@/lib/payments/checkout";
import { syncConnectAccount } from "@/lib/payments/stripe/connect";
import { recordAuditEvent } from "@/lib/payments/ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Stripe webhook — source of truth for payment and Connect account updates.
 * Never log secrets, card data, or bank details.
 */
export async function POST(req: Request) {
  if (!isStripeConfigured()) {
    return new Response("Stripe not configured", { status: 503 });
  }

  const secret = getStripeWebhookSecret();
  if (!secret) {
    console.error("[stripe:webhook] missing webhook secret");
    return new Response("Webhook secret not configured", { status: 503 });
  }

  const raw = await req.text();
  const signature = req.headers.get("stripe-signature") || "";
  const stripe = getStripe();

  let event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  const existing = await prisma.processedWebhookEvent.findUnique({
    where: {
      provider_eventId: { provider: "stripe", eventId: event.id },
    },
  });
  if (existing) {
    return Response.json({ ok: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const pi = event.data.object as {
          id: string;
          amount: number;
          currency: string;
          latest_charge?: string | null;
        };
        await markTxnFundedFromWebhook({
          paymentIntentId: pi.id,
          chargeId: typeof pi.latest_charge === "string" ? pi.latest_charge : undefined,
          amountMinor: pi.amount,
          currency: pi.currency,
          eventId: event.id,
        });
        break;
      }
      case "account.updated": {
        const account = event.data.object as { id: string; metadata?: { sourceBridgeUserId?: string } };
        const userId = account.metadata?.sourceBridgeUserId;
        if (userId) {
          try {
            await syncConnectAccount(userId);
          } catch {
            // Account may not be linked yet
          }
        } else {
          const row = await prisma.stripeConnectAccount.findUnique({
            where: { stripeAccountId: account.id },
          });
          if (row) await syncConnectAccount(row.userId);
        }
        break;
      }
      default:
        await recordAuditEvent({
          action: "STRIPE_WEBHOOK_IGNORED",
          meta: { type: event.type, eventId: event.id },
        });
    }

    await prisma.processedWebhookEvent.create({
      data: {
        provider: "stripe",
        eventId: event.id,
        eventType: event.type,
        stripeMode: getStripeMode(),
      },
    });

    return Response.json({ ok: true });
  } catch (err) {
    console.error("[stripe:webhook] handler error", event.type);
    return new Response("Handler error", { status: 500 });
  }
}
