/**
 * Global Payouts thin-event handler — separate from Connect webhooks.
 * Dedupe via ProcessedWebhookEvent provider=stripe_gp. Fail closed. No secrets logged.
 */

import { prisma } from "@/lib/db";
import {
  assertStripeModeCompatible,
  isGlobalPayoutsEnabled,
  normalizeStripeMode,
  type StripeMode,
} from "@/lib/payments/flags";
import { syncGlobalPayoutRecipientByStripeId } from "@/lib/payments/payout-rail/recipient";
import {
  canAdvanceOutboundStatus,
  mapThinOutboundEventType,
} from "@/lib/payments/payout-rail/status-mapper";
import { finalizeOutboundSuccess } from "@/lib/payments/payout-rail/outbound-payment";
import type { ProtectedStatus } from "@/lib/payments/state-machine";
import { isGlobalPayoutsEventDestinationPing } from "@/lib/payments/payout-rail/webhook-verify";

export const GP_WEBHOOK_PROVIDER = "stripe_gp";

export {
  getGlobalPayoutsWebhookSecret,
  getGlobalPayoutsWebhookSecrets,
  isGlobalPayoutsEventDestinationPing,
  verifyGlobalPayoutsThinEvent,
  GP_EVENT_DESTINATION_PING,
} from "@/lib/payments/payout-rail/webhook-verify";

function redactForLog(payload: unknown): string {
  try {
    const s = JSON.stringify(payload);
    return s
      .replace(/"number"\s*:\s*"[^"]+"/gi, '"number":"[redacted]"')
      .replace(/"iban"\s*:\s*"[^"]+"/gi, '"iban":"[redacted]"')
      .replace(/"account_number"\s*:\s*"[^"]+"/gi, '"account_number":"[redacted]"')
      .slice(0, 2000);
  } catch {
    return "[unserializable]";
  }
}

export async function handleGlobalPayoutsThinEvent(opts: {
  eventId: string;
  eventType: string;
  stripeMode: StripeMode;
  relatedObjectId?: string | null;
  relatedObjectType?: string | null;
  raw?: unknown;
}): Promise<{ action: string }> {
  // Destination ping: ack only — no dedupe row, sync, or outbound mutation.
  if (isGlobalPayoutsEventDestinationPing(opts.eventType)) {
    return { action: "ping_ack" };
  }

  if (!isGlobalPayoutsEnabled()) {
    // Ack + store so Stripe does not retry forever; no business mutation.
    await prisma.processedWebhookEvent
      .create({
        data: {
          provider: GP_WEBHOOK_PROVIDER,
          eventId: opts.eventId,
          eventType: opts.eventType,
          stripeMode: opts.stripeMode,
        },
      })
      .catch(() => null);
    return { action: "gp_disabled_ack" };
  }

  try {
    assertStripeModeCompatible(opts.stripeMode);
  } catch {
    await prisma.processedWebhookEvent
      .create({
        data: {
          provider: GP_WEBHOOK_PROVIDER,
          eventId: opts.eventId,
          eventType: opts.eventType,
          stripeMode: opts.stripeMode,
        },
      })
      .catch(() => null);
    return { action: "live_disabled_ack" };
  }

  const existing = await prisma.processedWebhookEvent.findUnique({
    where: {
      provider_eventId: {
        provider: GP_WEBHOOK_PROVIDER,
        eventId: opts.eventId,
      },
    },
  });
  if (existing) return { action: "duplicate" };

  const type = opts.eventType;
  const relatedId = opts.relatedObjectId || "";

  try {
    if (
      type.includes("account") ||
      type.includes("recipient") ||
      type.includes("payout_method")
    ) {
      if (relatedId) {
        await syncGlobalPayoutRecipientByStripeId(relatedId, opts.stripeMode);
      }
    } else if (
      type.includes("outbound_payment") ||
      type.includes("outboundpayment")
    ) {
      await reconcileOutboundFromEvent({
        eventType: type,
        outboundPaymentId: relatedId,
        stripeMode: opts.stripeMode,
      });
    } else {
      console.info(
        "[gp:webhook] unhandled type",
        type,
        redactForLog(opts.raw),
      );
    }

    await prisma.processedWebhookEvent.create({
      data: {
        provider: GP_WEBHOOK_PROVIDER,
        eventId: opts.eventId,
        eventType: opts.eventType,
        stripeMode: opts.stripeMode,
      },
    });
    return { action: "processed" };
  } catch (err) {
    console.error("[gp:webhook] handler failed", {
      eventId: opts.eventId,
      eventType: opts.eventType,
      message: err instanceof Error ? err.message : "error",
    });
    // Fail closed — do not mark processed so Stripe retries.
    throw err;
  }
}

async function reconcileOutboundFromEvent(opts: {
  eventType: string;
  outboundPaymentId: string;
  stripeMode: StripeMode;
}) {
  if (!opts.outboundPaymentId) return;
  const attempt = await prisma.outboundPaymentAttempt.findFirst({
    where: { stripeOutboundPaymentId: opts.outboundPaymentId },
  });
  if (!attempt) return;

  const mapped = mapThinOutboundEventType(opts.eventType);
  if (!mapped) return;
  if (!canAdvanceOutboundStatus(attempt.status, mapped)) return;

  if (mapped === "SUCCEEDED" && attempt.status !== "SUCCEEDED") {
    const txn = await prisma.protectedTransaction.findUnique({
      where: { id: attempt.protectedTxnId },
    });
    if (!txn) return;
    assertStripeModeCompatible(txn.stripeMode);
    const isFullResidual =
      attempt.kind !== "FINAL" ||
      !attempt.idempotencyKey.includes("_admin_");
    await finalizeOutboundSuccess({
      attemptId: attempt.id,
      outboundId: opts.outboundPaymentId,
      txn,
      status: txn.status as ProtectedStatus,
      domainAction:
        attempt.kind === "PROCUREMENT" ? "RELEASE_PROCUREMENT" : "RELEASE_FINAL",
      kind: attempt.kind === "PROCUREMENT" ? "PROCUREMENT" : "FINAL",
      amount: attempt.amountMinor,
      idempotencyKey: attempt.idempotencyKey,
      isFullResidual,
    });
    return;
  }

  if (mapped === "FAILED" || mapped === "ACTION_REQUIRED") {
    await prisma.outboundPaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: mapped,
        failureCode: mapped,
        lastAttemptAt: new Date(),
      },
    });
    return;
  }

  if (mapped === "RETURNED") {
    await prisma.outboundPaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "RETURNED",
        returnedAt: new Date(),
        lastAttemptAt: new Date(),
        reconciliationNote: "Provider returned funds to Financial Account — manual review",
      },
    });
    return;
  }

  if (mapped === "PROCESSING") {
    await prisma.outboundPaymentAttempt.update({
      where: { id: attempt.id },
      data: { status: "PROCESSING", lastAttemptAt: new Date() },
    });
  }

  void normalizeStripeMode(opts.stripeMode);
}
