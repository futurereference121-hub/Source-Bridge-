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
import { assertPaymentsTestAllowlisted } from "@/lib/payments/allowlist";
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
 * Idempotent: reuses an existing open PaymentIntent for the same txn when still payable.
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

  const buyer = await prisma.user.findUniqueOrThrow({
    where: { id: txn.buyerId },
    select: { id: true, email: true },
  });
  const seller = await prisma.user.findUniqueOrThrow({
    where: { id: txn.sellerId },
    select: { id: true, email: true },
  });
  assertPaymentsTestAllowlisted([buyer, seller], {
    action: "start Protected Payment checkout",
  });

  if (txn.status === "FUNDED" || txn.fundedAt) {
    throw Object.assign(new Error("Transaction is already funded"), {
      status: 409,
      code: "ALREADY_FUNDED",
    });
  }

  if (txn.status === "CANCELLED") {
    throw Object.assign(new Error("Transaction was cancelled (terms may have been revised)"), {
      status: 409,
      code: "TXN_CANCELLED",
    });
  }

  if (!["ACCEPTED", "AWAITING_PAYMENT"].includes(txn.status)) {
    throw Object.assign(new Error(`Cannot pay from status ${txn.status}`), {
      status: 409,
    });
  }

  // Refuse stale terms: ticket must still match active open ticket
  const ticket = await prisma.paymentTicket.findFirst({
    where: { protectedTransactionId: txn.id },
  });
  if (!ticket || ticket.status === "SUPERSEDED" || ticket.status === "DECLINED") {
    throw Object.assign(new Error("Terms have changed — reopen Payment Ticket"), {
      status: 409,
      code: "STALE_TERMS",
    });
  }
  if (ticket.termsHash !== txn.termsHash) {
    throw Object.assign(new Error("Terms have changed — reopen Payment Ticket"), {
      status: 409,
      code: "STALE_TERMS",
    });
  }

  const stripe = getStripe();

  // Idempotent: reuse open PaymentIntent (no second charge path for same terms).
  if (txn.stripePaymentIntentId) {
    try {
      const existing = await stripe.paymentIntents.retrieve(txn.stripePaymentIntentId);
      const reusable =
        existing.status === "requires_payment_method" ||
        existing.status === "requires_confirmation" ||
        existing.status === "requires_action" ||
        existing.status === "requires_capture";
      if (
        reusable &&
        existing.amount === txn.totalChargeMinor &&
        existing.currency?.toLowerCase() === txn.currency.toLowerCase() &&
        !existing.livemode
      ) {
        if (txn.status === "ACCEPTED") {
          await prisma.protectedTransaction.update({
            where: { id: txn.id },
            data: { status: nextStatus("ACCEPTED", "START_CHECKOUT") },
          });
        }
        return {
          clientSecret: existing.client_secret,
          paymentIntentId: existing.id,
          publishableKey: getStripePublishableKey(),
          amountMinor: txn.totalChargeMinor,
          currency: txn.currency,
          transaction: txn,
          reused: true as const,
        };
      }
      if (existing.status === "succeeded") {
        throw Object.assign(
          new Error("Payment already succeeded — wait for funding confirmation"),
          { status: 409, code: "PI_ALREADY_SUCCEEDED" },
        );
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "PI_ALREADY_SUCCEEDED") throw err;
      // Missing PI or API error — fall through to create with idempotency key
    }
  }

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
        releaseStrategy: "KEEP_ALL_PROTECTED",
      },
      automatic_payment_methods: { enabled: true },
    },
    { idempotencyKey: opts.idempotencyKey },
  );

  if (intent.livemode) {
    throw Object.assign(new Error("Live PaymentIntents are refused"), {
      status: 503,
      code: "LIVE_PI_REFUSED",
    });
  }

  const status = txn.status as ProtectedStatus;
  const updated = await prisma.protectedTransaction.update({
    where: { id: txn.id },
    data: {
      status: nextStatus(status, "START_CHECKOUT"),
      stripePaymentIntentId: intent.id,
    },
  });

  await recordAuditEvent({
    protectedTxnId: txn.id,
    actorUserId: opts.buyerId,
    action: "START_CHECKOUT",
    meta: { paymentIntentId: intent.id, reused: false },
  });

  return {
    clientSecret: intent.client_secret,
    paymentIntentId: intent.id,
    publishableKey: getStripePublishableKey(),
    amountMinor: txn.totalChargeMinor,
    currency: txn.currency,
    transaction: updated,
    reused: false as const,
  };
}

/** Apply funding from verified webhook (source of truth). Never transfers on PROTECTED fund. */
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

  if (txn.status === "CANCELLED") {
    await recordAuditEvent({
      protectedTxnId: txn.id,
      action: "FUNDING_REJECTED_CANCELLED",
      meta: { eventId: opts.eventId, paymentIntentId: opts.paymentIntentId },
    });
    return { handled: false, reason: "txn_cancelled" };
  }

  // Parties must still be allowlisted at fund time (fail closed).
  const buyer = await prisma.user.findUnique({
    where: { id: txn.buyerId },
    select: { id: true, email: true },
  });
  const seller = await prisma.user.findUnique({
    where: { id: txn.sellerId },
    select: { id: true, email: true },
  });
  if (!buyer || !seller) {
    return { handled: false, reason: "party_missing" };
  }
  try {
    assertPaymentsTestAllowlisted([buyer, seller], { action: "fund protected transaction" });
  } catch {
    await recordAuditEvent({
      protectedTxnId: txn.id,
      action: "FUNDING_REJECTED_ALLOWLIST",
      meta: { eventId: opts.eventId },
    });
    return { handled: false, reason: "allowlist" };
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
    meta: {
      eventId: opts.eventId,
      releaseStrategy: "KEEP_ALL_PROTECTED",
      transferOnFund: false,
    },
  });

  await prisma.paymentTicket.updateMany({
    where: { protectedTransactionId: txn.id },
    data: { status: "FUNDED" },
  });

  // KEEP_ALL_PROTECTED (this TEST ramp): no seller transfer on fund.
  // Instant / procurement only when those flags are deliberately on (not this phase).
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
  // PROTECTED + PROCUREMENT off + INSTANT off → funds stay on platform until delivery release.

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
