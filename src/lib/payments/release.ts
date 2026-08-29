import { prisma } from "@/lib/db";
import { appendLedgerEntry, recordAuditEvent } from "@/lib/payments/ledger";
import {
  assertMoneyOpEnvironmentMatch,
  assertStripeModeCompatible,
  isPaymentsEnabled,
  normalizeStripeMode,
} from "@/lib/payments/flags";
import { getStripe, isStripeConfigured, CHARGE_MODEL } from "@/lib/payments/stripe/client";
import {
  canTransition,
  nextStatus,
  type DomainAction,
  type ProtectedStatus,
} from "@/lib/payments/state-machine";
import { markListingSoldIfLinked } from "@/lib/payments/listing-lifecycle";
import { isDirectPaymentOption } from "@/lib/payments/payment-option";
import {
  assertFinalReleaseInvariants,
  assertProcurementReleaseInvariants,
  computeProtectedFinancials,
} from "@/lib/payments/breakdown";
import { afterProtectedTxnMoneyEvent } from "@/lib/payments/ticket-mutation-sync";

/**
 * Release engine — Separate Charges and Transfers.
 * Rechecks domain state before every money movement.
 *
 * Procurement is buyer-authorized only (never auto from fund webhook).
 * Final residual only: procurementTransferred + finalTransferred <= sellerEntitled.
 *
 * Stage A (platform → connected Stripe balance): `stripe.transfers.create`
 * runs synchronously inside releaseFinal / releaseProcurement — no SB delay
 * queue after authorization. Buyer/admin paths call these immediately.
 * Inspection-timer expiry is polled by /api/cron/payments-release (every 10m).
 *
 * Stage B (connected balance → external bank): Connect accounts use
 * dashboard=express. Source Bridge does NOT create Instant or bank payouts
 * on connected accounts — bank payout scheduling stays Stripe/account controlled.
 * Instant Payout would only be safe with verified Instant Payouts capability,
 * eligible external method, available balance, and country/currency support;
 * Express dashboard model leaves that to the connected account.
 */

export async function releaseProcurement(opts: {
  protectedTxnId: string;
  actorUserId?: string | null;
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
  assertStripeModeCompatible(txn.stripeMode);
  const txnMode = normalizeStripeMode(txn.stripeMode);

  // Direct uses Destination Charges only — never platform procurement transfer.
  if (isDirectPaymentOption(txn.paymentOption)) {
    throw Object.assign(
      new Error("Procurement release is not available for Direct Payment"),
      { status: 409, code: "DIRECT_NO_PROCUREMENT" },
    );
  }

  if (!txn.procurementAdvanceAgreed || txn.procurementAdvanceMinor <= 0) {
    throw Object.assign(new Error("No procurement advance on this transaction"), {
      status: 400,
      code: "NO_PROCUREMENT",
    });
  }
  if (txn.refundedMinor > 0 || ["REFUNDED", "PARTIALLY_REFUNDED", "CANCELLED", "DISPUTED", "RELEASED"].includes(txn.status)) {
    throw Object.assign(
      new Error(`Cannot release procurement from status ${txn.status}`),
      { status: 409, code: "INVALID_STATUS" },
    );
  }
  if (txn.procurementTransferredMinor >= txn.procurementAdvanceMinor) {
    return { alreadyReleased: true, txn };
  }

  const status = txn.status as ProtectedStatus;
  if (!canTransition(status, "RELEASE_PROCUREMENT")) {
    throw Object.assign(
      new Error(`Cannot release procurement from status ${status}`),
      { status: 409, code: "INVALID_TRANSITION" },
    );
  }

  const connect = await prisma.stripeConnectAccount.findUnique({
    where: {
      userId_stripeMode: {
        userId: txn.sellerId,
        stripeMode: txnMode,
      },
    },
  });
  if (!connect?.chargesEnabled || !connect.payoutsEnabled) {
    throw Object.assign(
      new Error(
        txnMode === "LIVE"
          ? "Sourcer must complete Live payment onboarding before funds can be transferred."
          : "Sourcer must complete payment onboarding before funds can be transferred.",
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
    connectStripeMode: connect.stripeMode,
    clientStripeMode: txnMode,
  });

  const books = computeProtectedFinancials(txn);
  const amount = books.procurementAdvanceMinor - books.procurementTransferredMinor;
  // Cap must be item cost only (helper already caps advance at itemCost).
  if (amount <= 0) {
    return { alreadyReleased: true, txn };
  }
  if (amount > books.itemCostMinor) {
    throw Object.assign(
      new Error("Procurement advance cannot include shipping or fees"),
      { status: 409, code: "PROCUREMENT_NOT_ITEM_ONLY" },
    );
  }
  assertProcurementReleaseInvariants({
    sellerEntitledMinor: books.sellerEntitledMinor,
    procurementAdvanceMinor: books.procurementAdvanceMinor,
    procurementTransferredMinor: books.procurementTransferredMinor,
    finalTransferredMinor: books.finalTransferredMinor,
    nextProcurementDelta: amount,
  });

  const idempotencyKey = `proc_xfer_${txn.id}_${txn.termsHash}`;

  const existingAttempt = await prisma.transferAttempt.findUnique({
    where: { idempotencyKey },
  });
  if (existingAttempt?.status === "SUCCEEDED") {
    return { alreadyReleased: true, txn };
  }

  const attempt =
    existingAttempt ||
    (await prisma.transferAttempt.create({
      data: {
        protectedTxnId: txn.id,
        kind: "PROCUREMENT",
        amountMinor: amount,
        currency: txn.currency,
        stripeMode: txnMode,
        idempotencyKey,
        status: "PENDING",
      },
    }));
  // Reopen FAILED for retry (new Stripe idempotency key when params evolve).
  if (existingAttempt && existingAttempt.status === "FAILED") {
    await prisma.transferAttempt.update({
      where: { id: existingAttempt.id },
      data: { status: "PENDING", lastAttemptAt: new Date() },
    });
  }

  const stripe = getStripe(txnMode);
  try {
    let sourceTransaction = (txn.stripeChargeId || "").trim();
    if (!sourceTransaction && txn.stripePaymentIntentId) {
      const pi = await stripe.paymentIntents.retrieve(txn.stripePaymentIntentId);
      const lc = pi.latest_charge;
      sourceTransaction =
        typeof lc === "string" ? lc : lc && typeof lc === "object" ? lc.id : "";
    }

    const presentmentCurrency = txn.currency.toLowerCase();
    let transferCurrency = presentmentCurrency;
    let transferAmountMinor = amount;

    // UK/EUR platforms often settle non-local charges into local currency.
    // source_transaction + matching settle currency is required for SCT releases.
    if (sourceTransaction) {
      const charge = await stripe.charges.retrieve(sourceTransaction, {
        expand: ["balance_transaction"],
      });
      const bt =
        charge.balance_transaction &&
        typeof charge.balance_transaction === "object"
          ? charge.balance_transaction
          : null;
      const settleCurrency = (bt?.currency || charge.currency || "").toLowerCase();
      if (settleCurrency && settleCurrency !== presentmentCurrency) {
        if (!bt || !charge.amount) {
          throw Object.assign(
            new Error(
              `Cannot convert procurement transfer ${presentmentCurrency}→${settleCurrency}: missing balance transaction`,
            ),
            { status: 409, code: "SETTLEMENT_FX_MISSING" },
          );
        }
        transferCurrency = settleCurrency;
        transferAmountMinor = Math.max(
          1,
          Math.floor((amount * bt.amount) / charge.amount),
        );
      }
    }

    const transferParams: {
      amount: number;
      currency: string;
      destination: string;
      transfer_group: string;
      metadata: Record<string, string>;
      source_transaction?: string;
    } = {
      amount: transferAmountMinor,
      currency: transferCurrency,
      destination: connect.stripeAccountId,
      transfer_group: txn.id,
      metadata: {
        protectedTxnId: txn.id,
        kind: "PROCUREMENT",
        chargeModel: CHARGE_MODEL,
        presentmentCurrency,
        presentmentAmountMinor: String(amount),
        settleCurrency: transferCurrency,
        settleAmountMinor: String(transferAmountMinor),
      },
    };
    if (sourceTransaction) {
      transferParams.source_transaction = sourceTransaction;
    }

    // When prior attempt failed without settlement FX, Stripe idempotency
    // forbids changing params under the same key — bump retries.
    const stripeIdempotencyKey =
      existingAttempt &&
      (existingAttempt.status === "FAILED" || existingAttempt.status === "PENDING") &&
      existingAttempt.attemptCount > 0
        ? `${idempotencyKey}_srcfx_a${existingAttempt.attemptCount}`
        : sourceTransaction
          ? `${idempotencyKey}_srcfx`
          : idempotencyKey;

    const transfer = await stripe.transfers.create(transferParams, {
      idempotencyKey: stripeIdempotencyKey,
    });

    const next = nextStatus(status, "RELEASE_PROCUREMENT");
    const updated = await prisma.$transaction(async (tx) => {
      await tx.transferAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "SUCCEEDED",
          stripeTransferId: transfer.id,
          succeededAt: new Date(),
          lastAttemptAt: new Date(),
        },
      });
      return tx.protectedTransaction.update({
        where: { id: txn.id },
        data: {
          status: next,
          procurementTransferredMinor: txn.procurementTransferredMinor + amount,
          procurementReleasedAt: new Date(),
          sellerConnectAccountId: connect.stripeAccountId,
        },
      });
    });

    await appendLedgerEntry({
      protectedTxnId: txn.id,
      entryType: "PROCUREMENT_TRANSFER",
      direction: "DEBIT",
      amountMinor: amount,
      currency: txn.currency,
      idempotencyKey: `ledger_${idempotencyKey}`,
      stripeObjectId: transfer.id,
      stripeObjectType: "transfer",
      meta: {
        settleCurrency: transferCurrency,
        settleAmountMinor: transferAmountMinor,
        sourceTransaction: sourceTransaction || null,
      },
    });
    await recordAuditEvent({
      protectedTxnId: txn.id,
      actorUserId: opts.actorUserId,
      action: "RELEASE_PROCUREMENT",
      meta: {
        transferId: transfer.id,
        amountMinor: amount,
        presentmentCurrency,
        settleCurrency: transferCurrency,
        settleAmountMinor: transferAmountMinor,
        sourceTransaction: sourceTransaction || null,
      },
    });

    const participantSync = await afterProtectedTxnMoneyEvent({
      txn: updated,
      event: "PROCUREMENT_RELEASED",
      actorUserId: opts.actorUserId,
    });

    return {
      alreadyReleased: false,
      txn: updated,
      transferId: transfer.id,
      activityVersion: participantSync.activityVersion,
      linkedTicketId: participantSync.linkedTicketId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transfer failed";
    await prisma.transferAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "FAILED",
        failureMessage: message.slice(0, 500),
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });
    throw err;
  }
}

export async function releaseFinal(opts: {
  protectedTxnId: string;
  actorUserId?: string | null;
  action?: Extract<DomainAction, "RELEASE_FINAL">;
  /**
   * Optional presentment-currency cap. Omitted = remaining residual (cron / buyer
   * release-now). Typed admin allocations pass the UI amount; server still
   * refuses anything above finalResidualMinor. Partial amounts do not mark
   * RELEASED so inspection cron cannot dump the withheld remainder.
   */
  amountMinor?: number;
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
  assertStripeModeCompatible(txn.stripeMode);
  const txnMode = normalizeStripeMode(txn.stripeMode);

  const status = txn.status as ProtectedStatus;
  // Direct uses Destination Charges only — never platform transfers.create.
  const isDirect = isDirectPaymentOption(txn.paymentOption);
  if (isDirect) {
    if (status === "RELEASED" || txn.releasedAt) {
      return { alreadyReleased: true, txn };
    }
    throw Object.assign(
      new Error(
        "Direct Payment uses Destination Charges; platform transfers.create is disabled for Direct. Leave SCT-funded Direct transactions for manual reconciliation.",
      ),
      { status: 409, code: "DIRECT_NO_PLATFORM_TRANSFER" },
    );
  }

  // PROTECTED only from here.
  const action: DomainAction = "RELEASE_FINAL";
  if (!canTransition(status, action)) {
    throw Object.assign(
      new Error(`Cannot release final from status ${status}`),
      { status: 409, code: "INVALID_TRANSITION" },
    );
  }

  if (status !== "READY_TO_RELEASE" && status !== "PARTIALLY_REFUNDED") {
    throw Object.assign(
      new Error(
        "Protected transactions require READY_TO_RELEASE (after delivery/inspection) before final release",
      ),
      { status: 409, code: "INSPECTION_REQUIRED" },
    );
  }

  const connect = await prisma.stripeConnectAccount.findUnique({
    where: {
      userId_stripeMode: {
        userId: txn.sellerId,
        stripeMode: txnMode,
      },
    },
  });
  if (!connect?.payoutsEnabled) {
    throw Object.assign(
      new Error(
        txnMode === "LIVE"
          ? "Sourcer must complete Live payment onboarding before funds can be transferred."
          : "Sourcer must complete payment onboarding before funds can be transferred.",
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
    connectStripeMode: connect.stripeMode,
    clientStripeMode: txnMode,
  });

  const books = computeProtectedFinancials(txn);
  const residual = books.finalResidualMinor;
  let amount = residual;
  let isFullResidual = true;
  if (opts.amountMinor != null) {
    const requested = Math.max(0, Math.floor(opts.amountMinor));
    if (requested <= 0) {
      return { alreadyReleased: true, txn, amountMinor: 0 };
    }
    if (requested > residual) {
      throw Object.assign(
        new Error(
          `Sourcer release cannot exceed remaining entitlement (${residual} minor units)`,
        ),
        {
          status: 409,
          code: "RELEASE_EXCEEDS_RESIDUAL",
          finalResidualMinor: residual,
        },
      );
    }
    amount = requested;
    isFullResidual = requested >= residual;
  }
  if (amount <= 0) {
    const next = nextStatus(status, action);
    const updated = await prisma.protectedTransaction.update({
      where: { id: txn.id },
      data: { status: next, releasedAt: new Date() },
    });
    await markListingSoldIfLinked(txn.listingId);
    return { alreadyReleased: true, txn: updated, amountMinor: 0 };
  }

  assertFinalReleaseInvariants({
    sellerEntitledMinor: books.sellerEntitledMinor,
    procurementTransferredMinor: books.procurementTransferredMinor,
    finalTransferredMinor: books.finalTransferredMinor,
    nextFinalDelta: amount,
  });

  const idempotencyKey = isFullResidual
    ? `final_xfer_${txn.id}_${txn.termsHash}`
    : `final_xfer_${txn.id}_${txn.termsHash}_admin_${amount}`;
  const existingAttempt = await prisma.transferAttempt.findUnique({
    where: { idempotencyKey },
  });
  // Stripe already paid — reconcile domain status if prior attempt left READY_TO_RELEASE stuck.
  if (existingAttempt?.status === "SUCCEEDED") {
    if (!isFullResidual) {
      if (status === "READY_TO_RELEASE") {
        const updated = await prisma.protectedTransaction.update({
          where: { id: txn.id },
          data: { status: "PARTIALLY_REFUNDED" },
        });
        return {
          alreadyReleased: true,
          txn: updated,
          transferId: existingAttempt.stripeTransferId,
          amountMinor: existingAttempt.amountMinor,
        };
      }
      return {
        alreadyReleased: true,
        txn,
        transferId: existingAttempt.stripeTransferId,
        amountMinor: existingAttempt.amountMinor,
      };
    }
    const next = nextStatus(status, action);
    const updated = await prisma.protectedTransaction.update({
      where: { id: txn.id },
      data: {
        status: next,
        finalTransferredMinor: Math.max(
          txn.finalTransferredMinor,
          existingAttempt.amountMinor,
        ),
        releasedAt: txn.releasedAt ?? existingAttempt.succeededAt ?? new Date(),
        sellerConnectAccountId:
          txn.sellerConnectAccountId || connect.stripeAccountId,
      },
    });
    await markListingSoldIfLinked(txn.listingId);
    return {
      alreadyReleased: true,
      txn: updated,
      transferId: existingAttempt.stripeTransferId,
      amountMinor: existingAttempt.amountMinor,
    };
  }

  const attempt =
    existingAttempt ||
    (await prisma.transferAttempt.create({
      data: {
        protectedTxnId: txn.id,
        kind: "FINAL",
        amountMinor: amount,
        currency: txn.currency,
        stripeMode: txnMode,
        idempotencyKey,
        status: "PENDING",
      },
    }));
  // Reopen FAILED for retry (new Stripe idempotency key when params evolve).
  if (existingAttempt && existingAttempt.status === "FAILED") {
    await prisma.transferAttempt.update({
      where: { id: existingAttempt.id },
      data: { status: "PENDING", lastAttemptAt: new Date() },
    });
  }

  const stripe = getStripe(txnMode);
  try {
    // Prefer charge id; fall back to PaymentIntent.latest_charge.
    let sourceTransaction = (txn.stripeChargeId || "").trim();
    if (!sourceTransaction && txn.stripePaymentIntentId) {
      const pi = await stripe.paymentIntents.retrieve(txn.stripePaymentIntentId);
      const lc = pi.latest_charge;
      sourceTransaction =
        typeof lc === "string" ? lc : lc && typeof lc === "object" ? lc.id : "";
    }

    const presentmentCurrency = txn.currency.toLowerCase();
    let transferCurrency = presentmentCurrency;
    let transferAmountMinor = amount;

    // UK/EUR platforms often settle non-local charges into local currency.
    // source_transaction + matching settle currency is required for SCT releases.
    if (sourceTransaction) {
      const charge = await stripe.charges.retrieve(sourceTransaction, {
        expand: ["balance_transaction"],
      });
      const bt =
        charge.balance_transaction &&
        typeof charge.balance_transaction === "object"
          ? charge.balance_transaction
          : null;
      const settleCurrency = (bt?.currency || charge.currency || "").toLowerCase();
      if (settleCurrency && settleCurrency !== presentmentCurrency) {
        if (!bt || !charge.amount) {
          throw Object.assign(
            new Error(
              `Cannot convert final transfer ${presentmentCurrency}â†’${settleCurrency}: missing balance transaction`,
            ),
            { status: 409, code: "SETTLEMENT_FX_MISSING" },
          );
        }
        // Pro-rate seller presentment share into settlement currency.
        transferCurrency = settleCurrency;
        transferAmountMinor = Math.max(
          1,
          Math.floor((amount * bt.amount) / charge.amount),
        );
      }
    }

    const transferParams: {
      amount: number;
      currency: string;
      destination: string;
      transfer_group: string;
      metadata: Record<string, string>;
      source_transaction?: string;
    } = {
      amount: transferAmountMinor,
      currency: transferCurrency,
      destination: connect.stripeAccountId,
      transfer_group: txn.id,
      metadata: {
        protectedTxnId: txn.id,
        kind: isFullResidual ? "FINAL" : "FINAL_PARTIAL",
        chargeModel: CHARGE_MODEL,
        presentmentCurrency,
        presentmentAmountMinor: String(amount),
        settleCurrency: transferCurrency,
        settleAmountMinor: String(transferAmountMinor),
        fullResidual: isFullResidual ? "1" : "0",
      },
    };
    if (sourceTransaction) {
      transferParams.source_transaction = sourceTransaction;
    }

    // When prior attempt failed without source_transaction / FX, Stripe
    // idempotency forbids changing params under the same key â€” bump retries.
    const stripeIdempotencyKey =
      existingAttempt &&
      (existingAttempt.status === "FAILED" || existingAttempt.status === "PENDING") &&
      existingAttempt.attemptCount > 0
        ? `${idempotencyKey}_srcfx_a${existingAttempt.attemptCount}`
        : sourceTransaction
          ? `${idempotencyKey}_srcfx`
          : idempotencyKey;

    const transfer = await stripe.transfers.create(transferParams, {
      idempotencyKey: stripeIdempotencyKey,
    });

    const next = isFullResidual
      ? nextStatus(status, action)
      : status === "READY_TO_RELEASE"
        ? "PARTIALLY_REFUNDED"
        : status;
    const updated = await prisma.$transaction(async (tx) => {
      await tx.transferAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "SUCCEEDED",
          // Keep presentment amount on the attempt for product accounting.
          amountMinor: amount,
          stripeTransferId: transfer.id,
          succeededAt: new Date(),
          lastAttemptAt: new Date(),
        },
      });
      return tx.protectedTransaction.update({
        where: { id: txn.id },
        data: {
          status: next,
          // Domain books stay in presentment currency (item share).
          finalTransferredMinor: txn.finalTransferredMinor + amount,
          releasedAt: isFullResidual ? new Date() : txn.releasedAt,
          sellerConnectAccountId: connect.stripeAccountId,
        },
      });
    });

    await appendLedgerEntry({
      protectedTxnId: txn.id,
      entryType: "FINAL_TRANSFER",
      direction: "DEBIT",
      amountMinor: amount,
      currency: txn.currency,
      idempotencyKey: `ledger_${idempotencyKey}`,
      stripeObjectId: transfer.id,
      stripeObjectType: "transfer",
      meta: {
        settleCurrency: transferCurrency,
        settleAmountMinor: transferAmountMinor,
        sourceTransaction: sourceTransaction || null,
      },
    });
    await recordAuditEvent({
      protectedTxnId: txn.id,
      actorUserId: opts.actorUserId,
      action: "RELEASE_FINAL",
      meta: {
        transferId: transfer.id,
        amountMinor: amount,
        presentmentCurrency,
        settleCurrency: transferCurrency,
        settleAmountMinor: transferAmountMinor,
        sourceTransaction: sourceTransaction || null,
        fullResidual: isFullResidual,
      },
    });

    if (isFullResidual) {
      await markListingSoldIfLinked(txn.listingId);
    }

    const participantSync = await afterProtectedTxnMoneyEvent({
      txn: updated,
      event: "FINAL_RELEASED",
      actorUserId: opts.actorUserId,
    });

    return {
      alreadyReleased: false,
      txn: updated,
      transferId: transfer.id,
      amountMinor: amount,
      activityVersion: participantSync.activityVersion,
      linkedTicketId: participantSync.linkedTicketId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transfer failed";
    await prisma.transferAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "FAILED",
        failureMessage: message.slice(0, 500),
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });
    throw err;
  }
}

/**
 * Cron/job entry:
 * 1) IN_INSPECTION with inspectionEndsAt <= now â†’ READY_TO_RELEASE â†’ releaseFinal
 * 2) Recover stuck READY_TO_RELEASE (e.g. prior transfer failure) â†’ releaseFinal only
 *
 * Duplicate runs are safe: releaseFinal is idempotent via transferAttempt + Stripe keys.
 */
export async function processInspectionReleases(limit = 25) {
  const now = new Date();
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  const seen = new Set<string>();

  const inspectionDue = await prisma.protectedTransaction.findMany({
    where: {
      status: "IN_INSPECTION",
      inspectionEndsAt: { lte: now },
    },
    take: limit,
    orderBy: { inspectionEndsAt: "asc" },
  });

  for (const txn of inspectionDue) {
    seen.add(txn.id);
    try {
      // Recheck state before money movement
      const fresh = await prisma.protectedTransaction.findUnique({
        where: { id: txn.id },
      });
      if (!fresh || fresh.status !== "IN_INSPECTION") {
        results.push({ id: txn.id, ok: false, error: "state_changed" });
        continue;
      }
      if (fresh.inspectionEndsAt && fresh.inspectionEndsAt > new Date()) {
        results.push({ id: txn.id, ok: false, error: "window_open" });
        continue;
      }
      // Buyer issue hold / dispute — never auto-release (status or open case).
      if ((fresh.status as string) === "DISPUTED") {
        results.push({ id: txn.id, ok: false, error: "disputed" });
        continue;
      }
      if (fresh.releasedAt) {
        results.push({ id: txn.id, ok: false, error: "already_released" });
        continue;
      }
      const openIssue = await prisma.disputeCase.findFirst({
        where: {
          protectedTxnId: fresh.id,
          status: { in: ["OPEN", "UNDER_REVIEW"] },
        },
        select: { id: true },
      });
      if (openIssue) {
        results.push({ id: txn.id, ok: false, error: "open_issue" });
        continue;
      }
      await prisma.protectedTransaction.update({
        where: { id: fresh.id },
        data: { status: nextStatus("IN_INSPECTION", "COMPLETE_INSPECTION") },
      });
      await releaseFinal({ protectedTxnId: fresh.id, actorUserId: null });
      results.push({ id: txn.id, ok: true });
    } catch (err) {
      results.push({
        id: txn.id,
        ok: false,
        error: err instanceof Error ? err.message : "error",
      });
    }
  }

  // Retry READY_TO_RELEASE left behind after a failed releaseFinal (or partial success).
  const remaining = Math.max(0, limit - results.filter((r) => r.ok).length);
  if (remaining > 0) {
    const stuckReady = await prisma.protectedTransaction.findMany({
      where: {
        status: "READY_TO_RELEASE",
        ...(seen.size
          ? { id: { notIn: Array.from(seen) } }
          : {}),
      },
      take: remaining,
      orderBy: { updatedAt: "asc" },
    });

    for (const txn of stuckReady) {
      try {
        const fresh = await prisma.protectedTransaction.findUnique({
          where: { id: txn.id },
        });
        if (!fresh || fresh.status !== "READY_TO_RELEASE") {
          results.push({ id: txn.id, ok: false, error: "state_changed" });
          continue;
        }
        await releaseFinal({ protectedTxnId: fresh.id, actorUserId: null });
        results.push({ id: txn.id, ok: true });
      } catch (err) {
        results.push({
          id: txn.id,
          ok: false,
          error: err instanceof Error ? err.message : "error",
        });
      }
    }
  }

  return results;
}

