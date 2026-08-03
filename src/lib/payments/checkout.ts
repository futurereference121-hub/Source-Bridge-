import { prisma } from "@/lib/db";
import { appendLedgerEntry, recordAuditEvent } from "@/lib/payments/ledger";
import {
  assertStripeModeCompatible,
  getStripeMode,
  isInstantPaymentsEnabled,
  isPaymentsEnabled,
  isProtectedPaymentsEnabled,
  isProcurementAdvancesEnabled,
} from "@/lib/payments/flags";
import {
  CHARGE_MODEL,
  getStripe,
  getStripePublishableKey,
  isStripeConfigured,
} from "@/lib/payments/stripe/client";
import { nextStatus, type ProtectedStatus } from "@/lib/payments/state-machine";
import { releaseFinal, releaseProcurement } from "@/lib/payments/release";

/**
 * Create a platform PaymentIntent (Separate Charges and Transfers).
 * Funds land on the platform; transfers happen at release — not at charge time.
 */
export async function createPaymentIntentForTxn(opts: {
  protectedTxnId: string;
  buyerId: string;
  idempotencyKey: string;
}) {
  if (!isPaymentsEnabled() || !isStripeConfigured()) {
    throw Object.assign(new Error("Payments not configured"), {
      status: 503,
      code: "STRIPE_NOT_CONFIGURED",
    });
  }

  const txn = await prisma.protectedTransaction.findUnique({
    where: { id: opts.protectedTxnId },
  });
  if (!txn) {
    throw Object.assign(new Error("Transaction not found"), { status: 404 });
  }
  if (txn.buyerId !== opts.buyerId) {
    throw Object.assign(new Error("Only the buyer can pay"), { status: 403 });
  }
  assertStripeModeCompatible(txn.stripeMode);

  if (txn.paymentOption === "PROTECTED" && !isProtectedPaymentsEnabled()) {
    throw Object.assign(new Error("Protected Payments disabled"), { status: 503 });
  }
  if (txn.paymentOption === "INSTANT" && !isInstantPaymentsEnabled()) {
    throw Object.assign(new Error("Instant payments disabled"), { status: 503 });
  }

  if (!["ACCEPTED", "AWAITING_PAYMENT"].includes(txn.status)) {
    throw Object.assign(new Error(`Cannot pay from status ${txn.status}`), {
      status: 409,
    });
  }

  // Refuse stale terms: ticket must still match
  const ticket = await prisma.paymentTicket.findFirst({
    where: { protectedTransactionId: txn.id },
  });
  if (ticket && ticket.termsHash !== txn.termsHash) {
    throw Object.assign(new Error("Terms have changed — reopen Payment Ticket"), {
      status: 409,
      code: "STALE_TERMS",
    });
  }

  const stripe = getStripe();
  const intent = await stripe.paymentIntents.create(
    {
      amount: txn.totalChargeMinor,
      currency: txn.currency.toLowerCase(),
      transfer_group: txn.id,
      metadata: {
        protectedTxnId: txn.id,
        termsHash: txn.termsHash,
        chargeModel: CHARGE_MODEL,
        paymentOption: txn.paymentOption,
      },
      automatic_payment_methods: { enabled: true },
    },
    { idempotencyKey: opts.idempotencyKey },
  );

  const updated = await prisma.protectedTransaction.update({
    where: { id: txn.id },
    data: {
      status: nextStatus(txn.status as ProtectedStatus, "START_CHECKOUT"),
      stripePaymentIntentId: intent.id,
    },
  });

  await recordAuditEvent({
    protectedTxnId: txn.id,
    actorUserId: opts.buyerId,
    action: "START_CHECKOUT",
    meta: { paymentIntentId: intent.id },
  });

  return {
    clientSecret: intent.client_secret,
    paymentIntentId: intent.id,
    publishableKey: getStripePublishableKey(),
    amountMinor: txn.totalChargeMinor,
    currency: txn.currency,
    transaction: updated,
  };
}

/** Apply funding from verified webhook (source of truth). */
export async function markTxnFundedFromWebhook(opts: {
  paymentIntentId: string;
  chargeId?: string;
  amountMinor: number;
  currency: string;
  eventId: string;
}) {
  const txn = await prisma.protectedTransaction.findFirst({
    where: { stripePaymentIntentId: opts.paymentIntentId },
  });
  if (!txn) return { handled: false, reason: "txn_not_found" };

  assertStripeModeCompatible(txn.stripeMode);

  if (txn.status === "FUNDED" || txn.fundedAt) {
    return { handled: true, reason: "already_funded" };
  }

  if (opts.amountMinor !== txn.totalChargeMinor) {
    await recordAuditEvent({
      protectedTxnId: txn.id,
      action: "FUNDING_AMOUNT_MISMATCH",
      meta: {
        expected: txn.totalChargeMinor,
        got: opts.amountMinor,
        eventId: opts.eventId,
      },
    });
    return { handled: false, reason: "amount_mismatch" };
  }

  const status = txn.status as ProtectedStatus;
  const updated = await prisma.protectedTransaction.update({
    where: { id: txn.id },
    data: {
      status: nextStatus(status, "MARK_FUNDED"),
      fundedAt: new Date(),
      stripeChargeId: opts.chargeId || txn.stripeChargeId,
    },
  });

  await appendLedgerEntry({
    protectedTxnId: txn.id,
    entryType: "CHARGE",
    direction: "CREDIT",
    amountMinor: opts.amountMinor,
    currency: opts.currency.toUpperCase(),
    idempotencyKey: `charge_${opts.paymentIntentId}`,
    stripeObjectId: opts.paymentIntentId,
    stripeObjectType: "payment_intent",
    meta: { eventId: opts.eventId, chargeId: opts.chargeId },
  });

  await recordAuditEvent({
    protectedTxnId: txn.id,
    action: "MARK_FUNDED",
    meta: { eventId: opts.eventId },
  });

  await prisma.paymentTicket.updateMany({
    where: { protectedTransactionId: txn.id },
    data: { status: "FUNDED" },
  });

  // Instant = same charge model + prompt transfer after funding success
  if (updated.paymentOption === "INSTANT" && isInstantPaymentsEnabled()) {
    try {
      await releaseFinal({ protectedTxnId: updated.id, actorUserId: null });
    } catch (err) {
      await recordAuditEvent({
        protectedTxnId: updated.id,
        action: "INSTANT_RELEASE_FAILED",
        meta: {
          error: err instanceof Error ? err.message : "unknown",
        },
      });
    }
  } else if (
    updated.procurementAdvanceAgreed &&
    updated.procurementAdvanceMinor > 0 &&
    isProcurementAdvancesEnabled()
  ) {
    try {
      await releaseProcurement({ protectedTxnId: updated.id, actorUserId: null });
    } catch (err) {
      await recordAuditEvent({
        protectedTxnId: updated.id,
        action: "PROCUREMENT_RELEASE_FAILED",
        meta: {
          error: err instanceof Error ? err.message : "unknown",
        },
      });
    }
  }

  return { handled: true, reason: "funded", txn: updated };
}

export function checkoutPublicConfig() {
  return {
    stripeConfigured: isStripeConfigured(),
    publishableKey: getStripePublishableKey() || null,
    stripeMode: getStripeMode(),
    chargeModel: CHARGE_MODEL,
  };
}
