/**
 * Global Payouts OutboundPayment release path — isolated from Connect transfers.create.
 * Platform absorbs GP fees; sourcer entitlement amount unchanged.
 * Never fall through to Connect. Never dual-pay.
 */

import { prisma } from "@/lib/db";
import { appendLedgerEntry, recordAuditEvent } from "@/lib/payments/ledger";
import {
  assertStripeModeCompatible,
  isPaymentsEnabled,
  normalizeStripeMode,
} from "@/lib/payments/flags";
import { isStripeConfigured } from "@/lib/payments/stripe/client";
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
import { lockedPayoutRailFromTxn } from "@/lib/payments/payout-rail/rail-resolver";
import { ensureFinancialAccountFunding } from "@/lib/payments/payout-rail/fa-funding";
import {
  getGlobalPayoutsFinancialAccountId,
  gpErrorMessage,
  gpFetch,
} from "@/lib/payments/payout-rail/gp-client";
import { canInitiateGlobalPayoutsMoney } from "@/lib/payments/payout-rail/eligibility";
import { mapOutboundPaymentProviderStatus } from "@/lib/payments/payout-rail/status-mapper";

async function assertNoConnectTransferSucceeded(
  protectedTxnId: string,
  kind: string,
): Promise<void> {
  const existing = await prisma.transferAttempt.findFirst({
    where: {
      protectedTxnId,
      kind,
      status: "SUCCEEDED",
    },
  });
  if (existing) {
    throw Object.assign(
      new Error("Connect transfer already succeeded for this stage — refusing Global Payouts"),
      { status: 409, code: "DUAL_RAIL_BLOCKED" },
    );
  }
}

async function assertNoGpSucceeded(
  protectedTxnId: string,
  kind: string,
): Promise<boolean> {
  const existing = await prisma.outboundPaymentAttempt.findFirst({
    where: {
      protectedTxnId,
      kind,
      status: { in: ["SUCCEEDED", "PROCESSING", "RECONCILED"] },
    },
  });
  return Boolean(existing && existing.status === "SUCCEEDED");
}

function countryMinimumBlocks(errMsg: string): boolean {
  const m = errMsg.toLowerCase();
  return m.includes("minimum") || m.includes("below_minimum") || m.includes("amount_too_small");
}

export async function releaseProcurementViaGlobalPayouts(opts: {
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

  if (lockedPayoutRailFromTxn(txn) !== "STRIPE_GLOBAL_PAYOUTS") {
    throw Object.assign(new Error("Transaction is not locked to Global Payouts"), {
      status: 409,
      code: "PAYOUT_RAIL_MISMATCH",
    });
  }

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
  if (
    txn.refundedMinor > 0 ||
    ["REFUNDED", "PARTIALLY_REFUNDED", "CANCELLED", "DISPUTED", "RELEASED"].includes(
      txn.status,
    )
  ) {
    throw Object.assign(
      new Error(`Cannot release procurement from status ${txn.status}`),
      { status: 409, code: "INVALID_STATUS" },
    );
  }
  if (txn.procurementTransferredMinor >= txn.procurementAdvanceMinor) {
    return { alreadyReleased: true, txn, transferId: "" as const };
  }

  const status = txn.status as ProtectedStatus;
  if (!canTransition(status, "RELEASE_PROCUREMENT")) {
    throw Object.assign(
      new Error(`Cannot release procurement from status ${status}`),
      { status: 409, code: "INVALID_TRANSITION" },
    );
  }

  await assertNoConnectTransferSucceeded(txn.id, "PROCUREMENT");
  if (await assertNoGpSucceeded(txn.id, "PROCUREMENT")) {
    return { alreadyReleased: true, txn, transferId: "" };
  }

  if (!txn.sellerGpRecipientId || !txn.sellerGpPayoutMethodId) {
    throw Object.assign(new Error("Global Payouts destination not locked on transaction"), {
      status: 409,
      code: "GP_NOT_READY",
    });
  }

  const books = computeProtectedFinancials(txn);
  const amount = books.procurementAdvanceMinor - books.procurementTransferredMinor;
  if (amount <= 0) return { alreadyReleased: true, txn, transferId: "" };
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

  return executeOutboundRelease({
    txn,
    txnMode,
    status,
    kind: "PROCUREMENT",
    domainAction: "RELEASE_PROCUREMENT",
    amount,
    idempotencyKey: `proc_gp_${txn.id}_${txn.termsHash}`,
    actorUserId: opts.actorUserId,
    isFullResidual: true,
  });
}

export async function releaseFinalViaGlobalPayouts(opts: {
  protectedTxnId: string;
  actorUserId?: string | null;
  action?: Extract<DomainAction, "RELEASE_FINAL">;
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
  const action = opts.action || "RELEASE_FINAL";

  if (lockedPayoutRailFromTxn(txn) !== "STRIPE_GLOBAL_PAYOUTS") {
    throw Object.assign(new Error("Transaction is not locked to Global Payouts"), {
      status: 409,
      code: "PAYOUT_RAIL_MISMATCH",
    });
  }

  if (isDirectPaymentOption(txn.paymentOption)) {
    throw Object.assign(
      new Error("Final release transfer is not used for Direct Payment"),
      { status: 409, code: "DIRECT_NO_PLATFORM_TRANSFER" },
    );
  }

  const status = txn.status as ProtectedStatus;
  if (!canTransition(status, action)) {
    throw Object.assign(
      new Error(`Cannot release final from status ${status}`),
      { status: 409, code: "INVALID_TRANSITION" },
    );
  }

  await assertNoConnectTransferSucceeded(txn.id, "FINAL");

  if (!txn.sellerGpRecipientId || !txn.sellerGpPayoutMethodId) {
    throw Object.assign(new Error("Global Payouts destination not locked on transaction"), {
      status: 409,
      code: "GP_NOT_READY",
    });
  }

  const books = computeProtectedFinancials(txn);
  const residual = books.finalResidualMinor;
  let amount = residual;
  let isFullResidual = true;
  if (opts.amountMinor != null) {
    const requested = Math.max(0, Math.floor(opts.amountMinor));
    if (requested <= 0) {
      return { alreadyReleased: true, txn, amountMinor: 0, transferId: "" };
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
    return { alreadyReleased: true, txn: updated, amountMinor: 0, transferId: "" };
  }

  assertFinalReleaseInvariants({
    sellerEntitledMinor: books.sellerEntitledMinor,
    procurementTransferredMinor: books.procurementTransferredMinor,
    finalTransferredMinor: books.finalTransferredMinor,
    nextFinalDelta: amount,
  });

  const idempotencyKey = isFullResidual
    ? `final_gp_${txn.id}_${txn.termsHash}`
    : `final_gp_${txn.id}_${txn.termsHash}_admin_${amount}`;

  return executeOutboundRelease({
    txn,
    txnMode,
    status,
    kind: "FINAL",
    domainAction: action,
    amount,
    idempotencyKey,
    actorUserId: opts.actorUserId,
    isFullResidual,
  });
}

async function executeOutboundRelease(opts: {
  txn: {
    id: string;
    sellerId: string;
    currency: string;
    termsHash: string;
    listingId: string | null;
    procurementTransferredMinor: number;
    finalTransferredMinor: number;
    sellerGpRecipientId: string;
    sellerGpPayoutMethodId: string;
    stripeMode: string;
  };
  txnMode: "TEST" | "LIVE";
  status: ProtectedStatus;
  kind: "PROCUREMENT" | "FINAL";
  domainAction: DomainAction;
  amount: number;
  idempotencyKey: string;
  actorUserId?: string | null;
  isFullResidual: boolean;
}) {
  const { txn, txnMode, amount, idempotencyKey, kind } = opts;

  const existingAttempt = await prisma.outboundPaymentAttempt.findUnique({
    where: { idempotencyKey },
  });
  if (existingAttempt?.status === "SUCCEEDED") {
    const full = await prisma.protectedTransaction.findUniqueOrThrow({
      where: { id: txn.id },
    });
    return {
      alreadyReleased: true,
      txn: full,
      amountMinor: amount,
      transferId: existingAttempt.stripeOutboundPaymentId || "",
      outboundPaymentId: existingAttempt.stripeOutboundPaymentId || "",
    };
  }
  if (
    existingAttempt?.status === "PROCESSING" &&
    existingAttempt.stripeOutboundPaymentId
  ) {
    // Unknown result — do not create a second payment; reconcile later via events.
    throw Object.assign(
      new Error("Outbound payment already in progress — awaiting provider confirmation"),
      { status: 409, code: "GP_PAYMENT_IN_FLIGHT" },
    );
  }

  let attempt =
    existingAttempt ||
    (await prisma.outboundPaymentAttempt.create({
      data: {
        protectedTxnId: txn.id,
        kind,
        amountMinor: amount,
        currency: txn.currency,
        stripeMode: txnMode,
        idempotencyKey,
        status: "PENDING",
        stripeRecipientId: txn.sellerGpRecipientId,
        stripePayoutMethodId: txn.sellerGpPayoutMethodId,
      },
    }));

  if (existingAttempt && ["FAILED", "AWAITING_MINIMUM", "AWAITING_FA_FUNDS"].includes(existingAttempt.status)) {
    attempt = await prisma.outboundPaymentAttempt.update({
      where: { id: existingAttempt.id },
      data: { status: "PENDING", lastAttemptAt: new Date() },
    });
  }

  const funding = await ensureFinancialAccountFunding({
    mode: txnMode,
    amountMinor: amount,
    currency: txn.currency,
    idempotencyKey: `fa_fund_${attempt.id}`,
    protectedTxnId: txn.id,
  });

  if (funding.status === "error") {
    await prisma.outboundPaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "FAILED",
        failureCode: funding.code,
        failureMessage: funding.message.slice(0, 500),
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });
    throw Object.assign(new Error(funding.message), {
      status: 503,
      code: funding.code,
    });
  }

  if (funding.status === "awaiting_funds") {
    await prisma.outboundPaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "AWAITING_FA_FUNDS",
        stripeFinancialAccountId: funding.financialAccountId,
        failureMessage: funding.reason.slice(0, 500),
        lastAttemptAt: new Date(),
      },
    });
    // Preserve entitlement — do not advance domain transferred counters.
    throw Object.assign(
      new Error(
        "Payout is authorized but awaiting Financial Account funds. Entitlement preserved.",
      ),
      { status: 409, code: "GP_AWAITING_FA_FUNDS" },
    );
  }

  if (!canInitiateGlobalPayoutsMoney(txnMode)) {
    await prisma.outboundPaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "AWAITING_FA_FUNDS",
        stripeFinancialAccountId: funding.financialAccountId,
        failureCode: "GP_INITIATION_DISABLED",
        failureMessage: "Live/sandbox GP initiation disabled — entitlement preserved",
        lastAttemptAt: new Date(),
      },
    });
    throw Object.assign(
      new Error("Global Payouts initiation is disabled. Entitlement preserved."),
      { status: 503, code: "GLOBAL_PAYOUTS_INITIATION_DISABLED" },
    );
  }

  const faId =
    funding.financialAccountId ||
    getGlobalPayoutsFinancialAccountId(txnMode);

  const stripeIdempotencyKey =
    attempt.attemptCount > 1
      ? `${idempotencyKey}_a${attempt.attemptCount}`
      : idempotencyKey;

  try {
    const created = await gpFetch({
      mode: txnMode,
      method: "POST",
      path: "/v2/money_management/outbound_payments",
      moneyMutation: true,
      idempotencyKey: stripeIdempotencyKey,
      body: {
        from: { financial_account: faId },
        to: {
          payout_method: txn.sellerGpPayoutMethodId,
          recipient: txn.sellerGpRecipientId,
        },
        amount: {
          value: amount,
          currency: txn.currency.toLowerCase(),
        },
        metadata: {
          protectedTxnId: txn.id,
          kind,
          rail: "STRIPE_GLOBAL_PAYOUTS",
          termsHash: txn.termsHash,
        },
      },
    });

    if (!created.ok) {
      const message = gpErrorMessage(created);
      if (countryMinimumBlocks(message)) {
        await prisma.outboundPaymentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: "AWAITING_MINIMUM",
            failureCode: "BELOW_MINIMUM",
            failureMessage: message.slice(0, 500),
            stripeFinancialAccountId: faId,
            attemptCount: { increment: 1 },
            lastAttemptAt: new Date(),
          },
        });
        throw Object.assign(
          new Error(
            "Payout is below the local minimum. Entitlement preserved until combined or topped.",
          ),
          { status: 409, code: "GP_AWAITING_MINIMUM" },
        );
      }
      throw Object.assign(new Error(message), {
        status: 502,
        code: "GP_OUTBOUND_CREATE_FAILED",
      });
    }

    const outboundId =
      typeof created.body.id === "string" ? created.body.id : "";
    const providerStatus = mapOutboundPaymentProviderStatus(created.body);
    // Never mark paid on submit alone — PROCESSING until posted/succeeded event.
    const localStatus =
      providerStatus === "SUCCEEDED" ? "SUCCEEDED" : "PROCESSING";

    await prisma.outboundPaymentAttempt.update({
      where: { id: attempt.id },
      data: {
        status: localStatus,
        stripeOutboundPaymentId: outboundId,
        stripeFinancialAccountId: faId,
        initiatedAt: new Date(),
        lastAttemptAt: new Date(),
        ...(localStatus === "SUCCEEDED"
          ? { succeededAt: new Date(), postedAt: new Date() }
          : {}),
      },
    });

    if (localStatus !== "SUCCEEDED") {
      // Domain counters update only on SUCCEEDED (webhook or immediate posted).
      await recordAuditEvent({
        protectedTxnId: txn.id,
        actorUserId: opts.actorUserId,
        action:
          kind === "PROCUREMENT"
            ? "GP_OUTBOUND_INITIATED_PROCUREMENT"
            : "GP_OUTBOUND_INITIATED_FINAL",
        meta: {
          outboundPaymentId: outboundId,
          amountMinor: amount,
          attemptId: attempt.id,
        },
      });
      const fullPending = await prisma.protectedTransaction.findUniqueOrThrow({
        where: { id: txn.id },
      });
      return {
        alreadyReleased: false,
        pendingProvider: true,
        txn: fullPending,
        outboundPaymentId: outboundId,
        transferId: outboundId,
        amountMinor: amount,
      };
    }

    return finalizeOutboundSuccess({
      attemptId: attempt.id,
      outboundId,
      txn,
      status: opts.status,
      domainAction: opts.domainAction,
      kind,
      amount,
      idempotencyKey,
      actorUserId: opts.actorUserId,
      isFullResidual: opts.isFullResidual,
      providerBody: created.body,
    });
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      ["GP_AWAITING_MINIMUM", "GP_AWAITING_FA_FUNDS"].includes(
        String((err as { code?: string }).code),
      )
    ) {
      throw err;
    }
    const message = err instanceof Error ? err.message : "Outbound payment failed";
    await prisma.outboundPaymentAttempt.update({
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

export async function finalizeOutboundSuccess(opts: {
  attemptId: string;
  outboundId: string;
  txn: {
    id: string;
    listingId: string | null;
    procurementTransferredMinor: number;
    finalTransferredMinor: number;
    currency: string;
  };
  status: ProtectedStatus;
  domainAction: DomainAction;
  kind: "PROCUREMENT" | "FINAL";
  amount: number;
  idempotencyKey: string;
  actorUserId?: string | null;
  isFullResidual: boolean;
  providerBody?: Record<string, unknown>;
}) {
  const { txn, kind, amount, idempotencyKey } = opts;
  const next = nextStatus(opts.status, opts.domainAction);

  const feeMeta = extractProviderFees(opts.providerBody);

  const updated = await prisma.$transaction(async (tx) => {
    await tx.outboundPaymentAttempt.update({
      where: { id: opts.attemptId },
      data: {
        status: "SUCCEEDED",
        stripeOutboundPaymentId: opts.outboundId,
        succeededAt: new Date(),
        postedAt: new Date(),
        lastAttemptAt: new Date(),
        providerFeeMinor: feeMeta.providerFeeMinor,
        crossBorderFeeMinor: feeMeta.crossBorderFeeMinor,
        fxFeeMinor: feeMeta.fxFeeMinor,
        destinationCurrency: feeMeta.destinationCurrency,
        destinationAmountMinor: feeMeta.destinationAmountMinor,
        fxRateSnapshot: feeMeta.fxRateSnapshot,
      },
    });

    if (kind === "PROCUREMENT") {
      return tx.protectedTransaction.update({
        where: { id: txn.id },
        data: {
          status: next,
          procurementTransferredMinor: txn.procurementTransferredMinor + amount,
          procurementReleasedAt: new Date(),
        },
      });
    }

    // Partial admin finals: mirror Connect — PARTIALLY_REFUNDED when leaving READY_TO_RELEASE.
    const finalStatus = opts.isFullResidual
      ? next
      : opts.status === "READY_TO_RELEASE"
        ? "PARTIALLY_REFUNDED"
        : opts.status;
    return tx.protectedTransaction.update({
      where: { id: txn.id },
      data: {
        status: finalStatus,
        finalTransferredMinor: txn.finalTransferredMinor + amount,
        releasedAt: opts.isFullResidual ? new Date() : undefined,
      },
    });
  });

  await appendLedgerEntry({
    protectedTxnId: txn.id,
    entryType:
      kind === "PROCUREMENT" ? "PROCUREMENT_TRANSFER" : "FINAL_TRANSFER",
    direction: "DEBIT",
    amountMinor: amount,
    currency: txn.currency,
    idempotencyKey: `ledger_${idempotencyKey}`,
    stripeObjectId: opts.outboundId,
    stripeObjectType: "outbound_payment",
    meta: {
      rail: "STRIPE_GLOBAL_PAYOUTS",
      providerFeesAbsorbedByPlatform: true,
      ...feeMeta,
    },
  });

  await recordAuditEvent({
    protectedTxnId: txn.id,
    actorUserId: opts.actorUserId,
    action: kind === "PROCUREMENT" ? "RELEASE_PROCUREMENT" : "RELEASE_FINAL",
    meta: {
      outboundPaymentId: opts.outboundId,
      amountMinor: amount,
      rail: "STRIPE_GLOBAL_PAYOUTS",
      providerFeesAbsorbedByPlatform: true,
    },
  });

  if (kind === "FINAL" && opts.isFullResidual) {
    await markListingSoldIfLinked(txn.listingId);
  }

  const participantSync = await afterProtectedTxnMoneyEvent({
    txn: updated,
    event: kind === "PROCUREMENT" ? "PROCUREMENT_RELEASED" : "FINAL_RELEASED",
    actorUserId: opts.actorUserId,
  });

  return {
    alreadyReleased: false,
    txn: updated,
    outboundPaymentId: opts.outboundId,
    transferId: opts.outboundId,
    amountMinor: amount,
    activityVersion: participantSync.activityVersion,
    linkedTicketId: participantSync.linkedTicketId,
  };
}

function extractProviderFees(body?: Record<string, unknown>): {
  providerFeeMinor: number;
  crossBorderFeeMinor: number;
  fxFeeMinor: number;
  destinationCurrency: string;
  destinationAmountMinor: number;
  fxRateSnapshot: string;
} {
  const empty = {
    providerFeeMinor: 0,
    crossBorderFeeMinor: 0,
    fxFeeMinor: 0,
    destinationCurrency: "",
    destinationAmountMinor: 0,
    fxRateSnapshot: "",
  };
  if (!body) return empty;
  const fees = body.fees;
  let providerFeeMinor = 0;
  let crossBorderFeeMinor = 0;
  let fxFeeMinor = 0;
  if (Array.isArray(fees)) {
    for (const f of fees) {
      if (!f || typeof f !== "object") continue;
      const fee = f as { type?: string; amount?: { value?: number } };
      const val = typeof fee.amount?.value === "number" ? fee.amount.value : 0;
      const t = String(fee.type || "").toLowerCase();
      if (t.includes("cross")) crossBorderFeeMinor += val;
      else if (t.includes("fx") || t.includes("exchange")) fxFeeMinor += val;
      else providerFeeMinor += val;
    }
  }
  const toAmount =
    body.to && typeof body.to === "object"
      ? (body.to as { amount?: { value?: number; currency?: string } }).amount
      : undefined;
  const destinationAmountMinor =
    typeof toAmount?.value === "number" ? toAmount.value : 0;
  const destinationCurrency =
    typeof toAmount?.currency === "string" ? toAmount.currency : "";
  const fx =
    body.exchange_rate != null
      ? String(body.exchange_rate)
      : body.fx_rate != null
        ? String(body.fx_rate)
        : "";
  return {
    providerFeeMinor,
    crossBorderFeeMinor,
    fxFeeMinor,
    destinationCurrency,
    destinationAmountMinor,
    fxRateSnapshot: fx.slice(0, 64),
  };
}
