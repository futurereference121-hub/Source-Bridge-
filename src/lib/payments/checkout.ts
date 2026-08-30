import { prisma } from "@/lib/db";
import { appendLedgerEntry, recordAuditEvent } from "@/lib/payments/ledger";
import {
  assertMoneyOpEnvironmentMatch,
  assertPaymentIntentModeMatch,
  assertStripeModeCompatible,
  getStripeMode,
  isDirectPaymentsEnabled,
  isPaymentsEnabled,
  isProtectedPaymentsEnabled,
  normalizeStripeMode,
} from "@/lib/payments/flags";
import { assertPaymentsTestAllowlisted } from "@/lib/payments/allowlist";
import {
  CHARGE_MODEL,
  DIRECT_CHARGE_MODEL,
  getStripe,
  getStripePublishableKey,
  isStripeConfigured,
} from "@/lib/payments/stripe/client";
import { nextStatus, type ProtectedStatus } from "@/lib/payments/state-machine";
import { markListingSoldIfLinked } from "@/lib/payments/listing-lifecycle";
import { isDirectPaymentOption } from "@/lib/payments/payment-option";
import { getSellerConnectFundingState } from "@/lib/payments/stripe/connect";

/**
 * Create a PaymentIntent for a ProtectedTransaction.
 *
 * PROTECTED: platform PI only (Separate Charges and Transfers). No transfer_data.
 * DIRECT: Destination Charges — transfer_data.destination + application_fee_amount.
 *   Fee approach: application_fee_amount = platform service fee (protectionFeeMinor).
 *   Seller automatically receives the remainder; no transfers.create on fund.
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
  const txnMode = normalizeStripeMode(txn.stripeMode);

  if (!isDirectPaymentOption(txn.paymentOption) && !isProtectedPaymentsEnabled()) {
    throw Object.assign(new Error("Protected Payments disabled"), { status: 503 });
  }
  if (isDirectPaymentOption(txn.paymentOption) && !isDirectPaymentsEnabled()) {
    throw Object.assign(new Error("Direct Payment is not enabled"), { status: 503 });
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

  // Chat tickets: refuse stale terms. Product listing checkout has no ticket.
  if (txn.origin !== "PRODUCT_CHECKOUT") {
    const ticket = await prisma.paymentTicket.findFirst({
      where: { protectedTransactionId: txn.id },
    });
    if (
      !ticket ||
      ticket.status === "SUPERSEDED" ||
      ticket.status === "DECLINED" ||
      ticket.status === "CANCELLED" ||
      ticket.status === "VOIDED" ||
      ticket.status === "DELETED" ||
      ticket.status === "EXPIRED" ||
      ticket.status === "FUNDED" ||
      ticket.status === "REFUNDED" ||
      ticket.hiddenFromChatAt
    ) {
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
  }

  const connectState = await getSellerConnectFundingState(txn.sellerId, txnMode);
  if (!connectState.ready || !connectState.stripeAccountId) {
    throw Object.assign(
      new Error(
        txnMode === "LIVE"
          ? "Sourcer must complete Live payment onboarding before this agreement can be funded."
          : "Sourcer must complete payment onboarding before this agreement can be funded.",
      ),
      {
        status: 409,
        code:
          txnMode === "LIVE"
            ? "LIVE_CONNECT_ONBOARDING_REQUIRED"
            : "CONNECT_NOT_READY",
      },
    );
  }
  assertMoneyOpEnvironmentMatch({
    txnStripeMode: txnMode,
    connectStripeMode: connectState.stripeMode,
    clientStripeMode: txnMode,
  });
  const stripe = getStripe(txnMode);
  const isDirect =
    isDirectPaymentOption(txn.paymentOption) && isDirectPaymentsEnabled();
  const sellerConnectId = connectState.stripeAccountId;

  const sellerShareMinor =
    txn.itemCostMinor + txn.shippingMinor + txn.sellerServiceFeeMinor;
  const platformFeeMinor = txn.protectionFeeMinor;
  if (isDirect && sellerShareMinor + platformFeeMinor !== txn.totalChargeMinor) {
    throw Object.assign(
      new Error("Direct Payment fee breakdown does not match total charge"),
      { status: 500, code: "FEE_TOTAL_MISMATCH" },
    );
  }

  // Idempotent: reuse open PaymentIntent only when architecture still matches.
  if (txn.stripePaymentIntentId) {
    try {
      const existing = await stripe.paymentIntents.retrieve(txn.stripePaymentIntentId);
      const reusable =
        existing.status === "requires_payment_method" ||
        existing.status === "requires_confirmation" ||
        existing.status === "requires_action" ||
        existing.status === "requires_capture";
      const existingDest =
        typeof existing.transfer_data?.destination === "string"
          ? existing.transfer_data.destination
          : existing.transfer_data?.destination &&
              typeof existing.transfer_data.destination === "object"
            ? (existing.transfer_data.destination as { id?: string }).id || ""
            : "";
      const architectureOk = isDirect
        ? Boolean(existingDest) &&
          existingDest === sellerConnectId &&
          (existing.application_fee_amount ?? 0) === platformFeeMinor
        : !existingDest;
      if (
        reusable &&
        architectureOk &&
        existing.amount === txn.totalChargeMinor &&
        existing.currency?.toLowerCase() === txn.currency.toLowerCase() &&
        Boolean(existing.livemode) === (txnMode === "LIVE")
      ) {
        if (txn.status === "ACCEPTED") {
          await prisma.protectedTransaction.update({
            where: { id: txn.id },
            data: { status: nextStatus("ACCEPTED", "START_CHECKOUT") },
          });
        }
        await prisma.paymentTicket.updateMany({
          where: { protectedTransactionId: txn.id },
          data: { lastMeaningfulActivityAt: new Date() },
        });
        return {
          clientSecret: existing.client_secret,
          paymentIntentId: existing.id,
          publishableKey: getStripePublishableKey(txnMode),
          stripeMode: txnMode,
          amountMinor: txn.totalChargeMinor,
          currency: txn.currency,
          transaction: txn,
          chargeModel: isDirect ? DIRECT_CHARGE_MODEL : CHARGE_MODEL,
          reused: true as const,
        };
      }
      if (existing.status === "succeeded") {
        // Client confirmed Stripe success before webhook — reconcile immediately.
        const reconciled = await markTxnFundedFromWebhook({
          paymentIntentId: existing.id,
          chargeId:
            typeof existing.latest_charge === "string"
              ? existing.latest_charge
              : undefined,
          amountMinor: existing.amount,
          currency: existing.currency,
          eventId: `client_reconcile_${existing.id}`,
        });
        throw Object.assign(
          new Error(
            reconciled.handled
              ? "Payment already funded"
              : "Payment already succeeded — wait for funding confirmation",
          ),
          {
            status: 409,
            code: reconciled.handled ? "ALREADY_FUNDED" : "PI_ALREADY_SUCCEEDED",
          },
        );
      }
      if (existing.status === "processing") {
        throw Object.assign(
          new Error("Payment is processing — wait for funding confirmation"),
          { status: 409, code: "PI_PROCESSING" },
        );
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "PI_ALREADY_SUCCEEDED" || code === "PI_PROCESSING") throw err;
      // Missing PI or architecture mismatch — fall through to create
    }
  }

  const baseMeta: Record<string, string> = {
    protectedTxnId: txn.id,
    termsHash: txn.termsHash,
    paymentOption: txn.paymentOption,
  };

  const intent = isDirect
    ? await stripe.paymentIntents.create(
        {
          amount: txn.totalChargeMinor,
          currency: txn.currency.toLowerCase(),
          // Destination Charges: automatic route to seller; Stripe FX on multi-currency.
          transfer_data: {
            destination: sellerConnectId,
          },
          // Platform keeps Source Bridge service fee; remainder → seller connected account.
          application_fee_amount: platformFeeMinor,
          transfer_group: txn.id,
          metadata: {
            ...baseMeta,
            chargeModel: DIRECT_CHARGE_MODEL,
            releaseStrategy: "DESTINATION_AUTO",
            sellerConnectAccountId: sellerConnectId,
            sellerShareMinor: String(sellerShareMinor),
            platformFeeMinor: String(platformFeeMinor),
          },
          automatic_payment_methods: { enabled: true },
        },
        { idempotencyKey: opts.idempotencyKey },
      )
    : await stripe.paymentIntents.create(
        {
          amount: txn.totalChargeMinor,
          currency: txn.currency.toLowerCase(),
          transfer_group: txn.id,
          // PROTECTED: no transfer_data — funds stay on platform until releaseFinal.
          metadata: {
            ...baseMeta,
            chargeModel: CHARGE_MODEL,
            releaseStrategy: "KEEP_ALL_PROTECTED",
          },
          automatic_payment_methods: { enabled: true },
        },
        { idempotencyKey: opts.idempotencyKey },
      );

  assertPaymentIntentModeMatch({
    txnStripeMode: txnMode,
    paymentIntentLivemode: intent.livemode,
  });

  const status = txn.status as ProtectedStatus;
  const updated = await prisma.protectedTransaction.update({
    where: { id: txn.id },
    data: {
      status: nextStatus(status, "START_CHECKOUT"),
      stripePaymentIntentId: intent.id,
      ...(isDirect && sellerConnectId
        ? { sellerConnectAccountId: sellerConnectId }
        : {}),
    },
  });

  await recordAuditEvent({
    protectedTxnId: txn.id,
    actorUserId: opts.buyerId,
    action: "START_CHECKOUT",
    meta: {
      paymentIntentId: intent.id,
      reused: false,
      chargeModel: isDirect ? DIRECT_CHARGE_MODEL : CHARGE_MODEL,
      destination: isDirect ? sellerConnectId : null,
      applicationFeeMinor: isDirect ? platformFeeMinor : null,
    },
  });
  await prisma.paymentTicket.updateMany({
    where: { protectedTransactionId: txn.id },
    data: { lastMeaningfulActivityAt: new Date() },
  });

  return {
    clientSecret: intent.client_secret,
    paymentIntentId: intent.id,
    publishableKey: getStripePublishableKey(txnMode),
    stripeMode: txnMode,
    amountMinor: txn.totalChargeMinor,
    currency: txn.currency,
    transaction: updated,
    chargeModel: isDirect ? DIRECT_CHARGE_MODEL : CHARGE_MODEL,
    reused: false as const,
  };
}

/**
 * Apply funding from verified webhook (source of truth).
 * PROTECTED: never transfers on fund.
 * DIRECT (Destination Charges): mark FUNDED + RELEASED from transfer_data; no transfers.create.
 */
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
    // Idempotent re-delivery: complete Destination release only when still pending.
    // SCT Direct orphans (no transfer_data.destination) stay FUNDED — finalize no-ops.
    if (
      isDirectPaymentOption(txn.paymentOption) &&
      isDirectPaymentsEnabled() &&
      txn.status !== "RELEASED" &&
      !txn.releasedAt
    ) {
      const release = await finalizeDirectDestinationFromWebhook({
        txn,
        paymentIntentId: opts.paymentIntentId,
        eventId: opts.eventId,
      });
      return {
        handled: true,
        reason: "already_funded_direct_retry",
        direct: release,
      };
    }
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
  let updated = await prisma.protectedTransaction.update({
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

  const directPath =
    isDirectPaymentOption(updated.paymentOption) && isDirectPaymentsEnabled();

  await recordAuditEvent({
    protectedTxnId: txn.id,
    action: "MARK_FUNDED",
    meta: {
      eventId: opts.eventId,
      paymentOption: updated.paymentOption,
      releaseStrategy: directPath ? "DESTINATION_AUTO" : "KEEP_ALL_PROTECTED",
      transferOnFund: false,
      chargeModel: directPath ? DIRECT_CHARGE_MODEL : CHARGE_MODEL,
    },
  });

  await prisma.paymentTicket.updateMany({
    where: { protectedTransactionId: txn.id },
    data: { status: "FUNDED", lastMeaningfulActivityAt: new Date() },
  });

  if (updated.conversationId) {
    try {
      const { bumpConversationActivity } = await import(
        "@/lib/conversation-activity"
      );
      await bumpConversationActivity(updated.conversationId, prisma, {
        touchLastMessage: true,
      });
    } catch (err) {
      console.error("[checkout:bump-activity-on-fund]", err);
    }
  }

  if (!directPath && updated.origin === "PRODUCT_CHECKOUT") {
    try {
      const { ensureProductPurchaseTicket } = await import(
        "@/lib/payments/product-purchase-ticket"
      );
      const ensured = await ensureProductPurchaseTicket(updated.id);
      if (ensured.conversationId) {
        updated = { ...updated, conversationId: ensured.conversationId };
      }
    } catch (err) {
      console.error("[checkout:product-purchase-ticket]", err);
    }
  }

  if (!directPath && (updated.conversationId || updated.origin === "PRODUCT_CHECKOUT")) {
    try {
      const { notifyPaymentFunded, notifyBuyerPaymentConfirmed } = await import(
        "@/lib/payment-notifications"
      );
      const [buyer, ticket] = await Promise.all([
        prisma.user.findUnique({
          where: { id: updated.buyerId },
          select: { username: true },
        }),
        prisma.paymentTicket.findFirst({
          where: { protectedTransactionId: updated.id },
          select: { id: true },
          orderBy: { updatedAt: "desc" },
        }),
      ]);
      await notifyPaymentFunded({
        protectedTxnId: updated.id,
        conversationId: updated.conversationId || "",
        sellerId: updated.sellerId,
        buyerId: updated.buyerId,
        title: updated.title || "Protected Payment",
        ticketId: ticket?.id,
        buyerUsername: buyer?.username,
        origin: updated.origin,
      });
      await notifyBuyerPaymentConfirmed({
        protectedTxnId: updated.id,
        buyerId: updated.buyerId,
        sellerId: updated.sellerId,
        title: updated.title || "Protected Payment",
        origin: updated.origin,
      });
    } catch (err) {
      console.error("[checkout:notify-funded]", err);
    }
  }

  // Direct: Destination Charges only — verify routing, mark RELEASED, NO transfers.create.
  if (directPath) {
    const release = await finalizeDirectDestinationFromWebhook({
      txn: updated,
      paymentIntentId: opts.paymentIntentId,
      eventId: opts.eventId,
    });
    return { handled: true, reason: "funded", txn: updated, direct: release };
  }

  // PROTECTED: MARK_FUNDED only. Never auto releaseProcurement on fund.
  // PROCUREMENT_ADVANCES_ENABLED means buyer-authorized Release Item Funds is available —
  // not automatic transfer after funding. Residual release remains post-inspection.

  return { handled: true, reason: "funded", txn: updated };
}

/**
 * After Destination Charge succeeds: verify transfer_data.destination, book RELEASED
 * in presentment amounts, mark listing SOLD. Never calls stripe.transfers.create.
 * Idempotent.
 */
async function finalizeDirectDestinationFromWebhook(opts: {
  txn: {
    id: string;
    status: string;
    paymentOption: string;
    sellerId: string;
    listingId: string | null;
    itemCostMinor: number;
    shippingMinor: number;
    sellerServiceFeeMinor: number;
    finalTransferredMinor: number;
    sellerConnectAccountId: string;
    currency: string;
    stripeMode: string;
    releasedAt: Date | null;
  };
  paymentIntentId: string;
  eventId: string;
}) {
  const { txn } = opts;
  if (txn.releasedAt || txn.status === "RELEASED") {
    return { released: true, reason: "already_released" as const };
  }

  const txnMode = normalizeStripeMode(txn.stripeMode);
  assertStripeModeCompatible(txnMode);

  let destinationId = "";
  let applicationFee: number | null = null;
  try {
    const stripe = getStripe(txnMode);
    const pi = await stripe.paymentIntents.retrieve(opts.paymentIntentId);
    const dest = pi.transfer_data?.destination;
    destinationId =
      typeof dest === "string"
        ? dest
        : dest && typeof dest === "object"
          ? (dest as { id?: string }).id || ""
          : "";
    applicationFee =
      typeof pi.application_fee_amount === "number"
        ? pi.application_fee_amount
        : null;
  } catch (err) {
    await recordAuditEvent({
      protectedTxnId: txn.id,
      action: "DIRECT_DESTINATION_PI_RETRIEVE_FAILED",
      meta: {
        eventId: opts.eventId,
        error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
      },
    });
    // Leave FUNDED — ops can inspect. Never invent transfers.create.
    return { released: false, reason: "pi_retrieve_failed" as const };
  }

  if (!destinationId) {
    // Legacy SCT Direct PI (e.g. orphaned FUNDED path if fund were re-processed).
    // Do NOT transfers.create — leave FUNDED for manual reconciliation only.
    await recordAuditEvent({
      protectedTxnId: txn.id,
      action: "DIRECT_DESTINATION_MISSING",
      meta: {
        eventId: opts.eventId,
        paymentIntentId: opts.paymentIntentId,
        note: "No transfer_data.destination — skipped platform transfer by design",
      },
    });
    return { released: false, reason: "destination_missing" as const };
  }

  const expectedConnect = await prisma.stripeConnectAccount.findUnique({
    where: {
      userId_stripeMode: {
        userId: txn.sellerId,
        stripeMode: txnMode,
      },
    },
    select: { stripeAccountId: true, stripeMode: true },
  });
  if (expectedConnect) {
    assertMoneyOpEnvironmentMatch({
      txnStripeMode: txnMode,
      connectStripeMode: expectedConnect.stripeMode,
      clientStripeMode: txnMode,
    });
  }
  if (
    expectedConnect?.stripeAccountId &&
    destinationId !== expectedConnect.stripeAccountId
  ) {
    await recordAuditEvent({
      protectedTxnId: txn.id,
      action: "DIRECT_DESTINATION_MISMATCH",
      meta: {
        eventId: opts.eventId,
        expected: expectedConnect.stripeAccountId,
        got: destinationId,
      },
    });
    return { released: false, reason: "destination_mismatch" as const };
  }

  const sellerShareMinor =
    txn.itemCostMinor + txn.shippingMinor + txn.sellerServiceFeeMinor;

  // Bookkeeping idempotency (no Stripe transfer object for destination auto-split).
  const ledgerKey = `dest_release_${txn.id}_${opts.paymentIntentId}`;

  const updated = await prisma.protectedTransaction.update({
    where: { id: txn.id },
    data: {
      status: nextStatus("FUNDED", "RELEASE_FINAL"),
      finalTransferredMinor: sellerShareMinor,
      releasedAt: new Date(),
      sellerConnectAccountId: destinationId,
    },
  });

  await appendLedgerEntry({
    protectedTxnId: txn.id,
    entryType: "FINAL_TRANSFER",
    direction: "DEBIT",
    amountMinor: sellerShareMinor,
    currency: txn.currency,
    idempotencyKey: ledgerKey,
    stripeObjectId: opts.paymentIntentId,
    stripeObjectType: "payment_intent",
    meta: {
      eventId: opts.eventId,
      chargeModel: DIRECT_CHARGE_MODEL,
      destination: destinationId,
      applicationFeeAmount: applicationFee,
      presentmentAmountMinor: sellerShareMinor,
      note: "Destination Charges — auto route; no transfers.create",
    },
  });

  await recordAuditEvent({
    protectedTxnId: txn.id,
    action: "RELEASE_FINAL",
    meta: {
      eventId: opts.eventId,
      chargeModel: DIRECT_CHARGE_MODEL,
      destination: destinationId,
      amountMinor: sellerShareMinor,
      applicationFeeAmount: applicationFee,
      transferCreated: false,
    },
  });

  await markListingSoldIfLinked(txn.listingId);

  await prisma.paymentTicket.updateMany({
    where: { protectedTransactionId: txn.id },
    data: { status: "RELEASED" },
  });

  return {
    released: true,
    reason: "destination_released" as const,
    destination: destinationId,
    amountMinor: sellerShareMinor,
    txn: updated,
  };
}

/** Buyer/seller status poll after client confirmPayment (funding is webhook-only). */
export async function getProtectedTxnPaymentStatus(opts: {
  protectedTxnId: string;
  viewerUserId: string;
}) {
  const txn = await prisma.protectedTransaction.findUnique({
    where: { id: opts.protectedTxnId },
    select: {
      id: true,
      status: true,
      paymentOption: true,
      buyerId: true,
      sellerId: true,
      fundedAt: true,
      releasedAt: true,
      finalTransferredMinor: true,
      totalChargeMinor: true,
      currency: true,
      listingId: true,
      stripePaymentIntentId: true,
      listing: {
        select: { id: true, slug: true, saleStatus: true, name: true },
      },
    },
  });
  if (!txn) {
    throw Object.assign(new Error("Transaction not found"), { status: 404 });
  }
  if (txn.buyerId !== opts.viewerUserId && txn.sellerId !== opts.viewerUserId) {
    throw Object.assign(new Error("Not a party to this transaction"), {
      status: 403,
    });
  }

  const isDirect = isDirectPaymentOption(txn.paymentOption);
  const complete =
    txn.status === "RELEASED" ||
    Boolean(txn.releasedAt) ||
    (!isDirect && Boolean(txn.fundedAt)) ||
    (isDirect && (txn.status === "FUNDED" || txn.status === "RELEASED"));

  return {
    id: txn.id,
    status: txn.status,
    paymentOption: txn.paymentOption,
    fundedAt: txn.fundedAt?.toISOString() ?? null,
    releasedAt: txn.releasedAt?.toISOString() ?? null,
    finalTransferredMinor: txn.finalTransferredMinor,
    totalChargeMinor: txn.totalChargeMinor,
    currency: txn.currency,
    isDirect,
    /** Buyer UX: true when payment is accepted (FUNDED+) — never wait forever. */
    paymentReceived: Boolean(txn.fundedAt) || ["FUNDED", "RELEASED"].includes(txn.status),
    complete: Boolean(complete && (txn.fundedAt || txn.status === "RELEASED" || txn.status === "FUNDED")),
    payoutSettled: isDirect
      ? txn.status === "RELEASED" || Boolean(txn.releasedAt)
      : txn.status === "RELEASED",
    listing: txn.listing
      ? {
          id: txn.listing.id,
          slug: txn.listing.slug,
          name: txn.listing.name,
          saleStatus: txn.listing.saleStatus,
        }
      : null,
  };
}

/**
 * After Stripe.js confirmPayment reports success (or PI is succeeded/processing),
 * retrieve the PI server-side and apply the same idempotent FUNDED transition the
 * webhook uses. Webhook redelivery later is a no-op via charge_${piId} ledger key.
 */
export async function reconcileTxnFundingFromStripe(opts: {
  protectedTxnId: string;
  viewerUserId: string;
}): Promise<{
  status: Awaited<ReturnType<typeof getProtectedTxnPaymentStatus>>;
  reconciled: boolean;
  paymentProcessing: boolean;
  reason: string;
}> {
  const txn = await prisma.protectedTransaction.findUnique({
    where: { id: opts.protectedTxnId },
    select: {
      id: true,
      buyerId: true,
      sellerId: true,
      status: true,
      fundedAt: true,
      stripePaymentIntentId: true,
      totalChargeMinor: true,
      currency: true,
      stripeMode: true,
    },
  });
  if (!txn) {
    throw Object.assign(new Error("Transaction not found"), { status: 404 });
  }
  if (txn.buyerId !== opts.viewerUserId && txn.sellerId !== opts.viewerUserId) {
    throw Object.assign(new Error("Not a party to this transaction"), {
      status: 403,
    });
  }
  assertStripeModeCompatible(txn.stripeMode);
  const txnMode = normalizeStripeMode(txn.stripeMode);

  if (txn.status === "FUNDED" || txn.fundedAt) {
    const status = await getProtectedTxnPaymentStatus(opts);
    return {
      status,
      reconciled: false,
      paymentProcessing: false,
      reason: "already_funded",
    };
  }

  if (!txn.stripePaymentIntentId) {
    const status = await getProtectedTxnPaymentStatus(opts);
    return {
      status,
      reconciled: false,
      paymentProcessing: false,
      reason: "no_payment_intent",
    };
  }

  if (!isStripeConfigured()) {
    throw Object.assign(new Error("Payments not configured"), {
      status: 503,
      code: "STRIPE_NOT_CONFIGURED",
    });
  }

  const stripe = getStripe(txnMode);
  const pi = await stripe.paymentIntents.retrieve(txn.stripePaymentIntentId);
  assertPaymentIntentModeMatch({
    txnStripeMode: txnMode,
    paymentIntentLivemode: pi.livemode,
  });

  if (pi.status === "processing") {
    const status = await getProtectedTxnPaymentStatus(opts);
    return {
      status,
      reconciled: false,
      paymentProcessing: true,
      reason: "pi_processing",
    };
  }

  if (pi.status !== "succeeded") {
    const status = await getProtectedTxnPaymentStatus(opts);
    return {
      status,
      reconciled: false,
      paymentProcessing: false,
      reason: `pi_${pi.status}`,
    };
  }

  if (pi.amount !== txn.totalChargeMinor) {
    const status = await getProtectedTxnPaymentStatus(opts);
    return {
      status,
      reconciled: false,
      paymentProcessing: false,
      reason: "amount_mismatch",
    };
  }

  const funded = await markTxnFundedFromWebhook({
    paymentIntentId: pi.id,
    chargeId: typeof pi.latest_charge === "string" ? pi.latest_charge : undefined,
    amountMinor: pi.amount,
    currency: pi.currency,
    eventId: `client_reconcile_${pi.id}`,
  });

  const status = await getProtectedTxnPaymentStatus(opts);
  return {
    status,
    reconciled: Boolean(funded.handled),
    paymentProcessing: !status.paymentReceived,
    reason: String(funded.reason || "reconciled"),
  };
}

export function checkoutPublicConfig() {
  return {
    stripeConfigured: isStripeConfigured(),
    publishableKey: getStripePublishableKey() || null,
    stripeMode: getStripeMode(),
    chargeModel: CHARGE_MODEL,
    directChargeModel: DIRECT_CHARGE_MODEL,
  };
}
