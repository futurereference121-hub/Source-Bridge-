import type { ProtectedTransaction } from "@prisma/client";
import { prisma } from "@/lib/db";
import { computeProtectedFinancials } from "@/lib/payments/breakdown";
import { parseHumanAmountToMinor } from "@/lib/payments/money";
import { planProtectedRefund } from "@/lib/payments/refunds";
import {
  canTransition,
  nextStatus,
  type ProtectedStatus,
} from "@/lib/payments/state-machine";
import {
  appendLedgerEntry,
  recordAuditEvent,
} from "@/lib/payments/ledger";
import {
  getStripe,
  isStripeConfigured,
} from "@/lib/payments/stripe/client";
import { isDirectPaymentOption } from "@/lib/payments/payment-option";

export type AdminMoneyResolution =
  | "RESOLVED_SELLER"
  | "RESOLVED_BUYER"
  | "RESOLVED_SPLIT"
  | "CLOSED";

export type AdminProtectedMoneyInput = {
  txn: ProtectedTransaction;
  adminUserId: string;
  resolution: AdminMoneyResolution;
  resolutionNote?: string;
  refundMinor?: number;
  refundMajor?: string;
  releaseMinor?: number;
  releaseMajor?: string;
  includePlatformFeeInRefund?: boolean;
  /** @deprecated Prefer releaseMinor. */
  releaseRemaining?: boolean;
  /** Idempotency namespace — dispute id or protected txn id. */
  idempotencyScope: string;
  auditAction: string;
  auditMeta?: Record<string, unknown>;
};

export type AdminProtectedMoneyResult = {
  working: ProtectedTransaction;
  refundAppliedMinor: number;
  releaseAppliedMinor: number;
  released: boolean;
  transferId: string | null;
  refundId: string | null;
  booksAtStart: ReturnType<typeof computeProtectedFinancials>;
};

function throwHttp(
  message: string,
  status: number,
  extra?: Record<string, unknown>,
): never {
  const err = new Error(message) as Error & {
    status: number;
    code?: string;
    [key: string]: unknown;
  };
  err.status = status;
  if (extra) Object.assign(err, extra);
  throw err;
}

function booksForTxn(txn: ProtectedTransaction) {
  return computeProtectedFinancials(txn);
}

/**
 * Shared admin refund / seller-release / split for Protected purchases.
 * Buyer refund → original PI/Charge (no Buyer Connect).
 * Seller release → that seller's own Connect via releaseFinal.
 * Does not invent or require a DisputeCase — callers decide dispute lifecycle.
 */
export async function executeAdminProtectedMoneyDecision(
  input: AdminProtectedMoneyInput,
): Promise<AdminProtectedMoneyResult> {
  const { txn } = input;
  if (isDirectPaymentOption(txn.paymentOption)) {
    throwHttp("Direct Payment issues are not resolved on this path", 409, {
      code: "DIRECT_NOT_SUPPORTED",
    });
  }
  if (txn.status === "RELEASED") {
    throwHttp(
      "Transaction already completed — cannot reopen money movement",
      409,
      { code: "ALREADY_RELEASED" },
    );
  }
  if (["REFUNDED", "CANCELLED", "FAILED"].includes(txn.status)) {
    // Full refund / cancelled / failed may still allow no-op idempotent paths
    // only when requested amounts are zero — handled below.
  }

  const booksAtStart = booksForTxn(txn);
  let refundAppliedMinor = 0;
  let releaseAppliedMinor = 0;
  let released = false;
  let transferId: string | null = null;
  let refundId: string | null = null;
  let working = txn;

  // Lift DISPUTED freeze so refund / residual paths can proceed.
  if (
    (working.status as ProtectedStatus) === "DISPUTED" &&
    canTransition("DISPUTED", "RESOLVE_DISPUTE")
  ) {
    working = await prisma.protectedTransaction.update({
      where: { id: working.id },
      data: {
        status: nextStatus("DISPUTED", "RESOLVE_DISPUTE"),
        inspectionEndsAt: null,
      },
    });
  }

  if (
    input.resolution === "RESOLVED_BUYER" ||
    input.resolution === "RESOLVED_SPLIT"
  ) {
    const books = booksForTxn(working);
    const feeStillOnPlatform = Math.min(
      books.platformFeeMinor - (working.platformFeeRefundedMinor ?? 0),
      books.protectedRemainingMinor,
    );
    const maxRefundExcludingFee = Math.max(
      0,
      books.protectedRemainingMinor - feeStillOnPlatform,
    );
    const maxRefundable = input.includePlatformFeeInRefund
      ? books.refundableMinor
      : maxRefundExcludingFee;
    const typedRefund =
      Boolean(input.refundMajor) || input.refundMinor != null;
    let requested = 0;
    if (input.refundMajor) {
      const parsedMajor = parseHumanAmountToMinor(
        input.refundMajor,
        working.currency,
      );
      if (parsedMajor == null) {
        throwHttp(
          "Enter a valid currency amount (e.g. 50.00), not minor units",
          400,
          { code: "INVALID_AMOUNT" },
        );
      }
      requested = parsedMajor;
    } else if (input.refundMinor != null) {
      requested = Math.max(0, Math.floor(input.refundMinor));
    } else if (input.resolution === "RESOLVED_BUYER") {
      requested = books.refundableMinor;
    }

    if (typedRefund && requested > maxRefundable) {
      throwHttp(
        `Refund capped at ${maxRefundable} minor units${input.includePlatformFeeInRefund ? "" : " (SB fee excluded — check include fee)"}`,
        409,
        {
          code: "REFUND_EXCEEDS_PLATFORM",
          refundableMinor: maxRefundable,
        },
      );
    }

    if (requested > 0) {
      if (!isStripeConfigured() || !working.stripePaymentIntentId) {
        throwHttp("Cannot refund without Stripe payment", 409, {
          code: "STRIPE_REQUIRED",
        });
      }
      const plan = planProtectedRefund({
        ...working,
        status: working.status,
        requestedMinor: requested,
      });
      if (plan.amountMinor <= 0) {
        throwHttp(plan.blockedReason || "No safe refundable amount", 409, {
          code: "REFUND_NOT_SAFE",
          refundableMinor: plan.refundableMinor,
        });
      }
      if (requested > plan.refundableMinor) {
        throwHttp(
          `Refund capped at platform remainder (${plan.refundableMinor} minor units)`,
          409,
          {
            code: "REFUND_EXCEEDS_PLATFORM",
            refundableMinor: plan.refundableMinor,
          },
        );
      }

      const stripe = getStripe();
      const refund = await stripe.refunds.create(
        {
          payment_intent: working.stripePaymentIntentId,
          amount: plan.amountMinor,
          metadata: {
            protectedTxnId: working.id,
            adminResolution: input.resolution,
            idempotencyScope: input.idempotencyScope,
          },
        },
        {
          idempotencyKey: `admin_refund_${input.idempotencyScope}_${plan.amountMinor}`,
        },
      );
      const feePortion = input.includePlatformFeeInRefund
        ? Math.min(feeStillOnPlatform, plan.amountMinor)
        : 0;
      await appendLedgerEntry({
        protectedTxnId: working.id,
        entryType: "REFUND",
        direction: "DEBIT",
        amountMinor: plan.amountMinor,
        currency: working.currency,
        idempotencyKey: `ledger_refund_${refund.id}`,
        stripeObjectId: refund.id,
        stripeObjectType: "refund",
      });
      working = await prisma.protectedTransaction.update({
        where: { id: working.id },
        data: {
          refundedMinor: working.refundedMinor + plan.amountMinor,
          platformFeeRefundedMinor:
            (working.platformFeeRefundedMinor ?? 0) + feePortion,
          status: plan.nextStatus,
        },
      });
      refundAppliedMinor = plan.amountMinor;
      refundId = refund.id;
    } else if (input.resolution === "RESOLVED_BUYER") {
      throwHttp("Nothing left on platform to refund to buyer", 409, {
        code: "NOTHING_REFUNDABLE",
        refundableMinor: books.refundableMinor,
      });
    }
  }

  const typedRelease =
    Boolean(input.releaseMajor) || input.releaseMinor != null;
  let requestedReleaseMinor = 0;
  if (input.releaseMajor) {
    const parsedMajor = parseHumanAmountToMinor(
      input.releaseMajor,
      working.currency,
    );
    if (parsedMajor == null) {
      throwHttp(
        "Enter a valid sourcer release amount (e.g. 50.00), not minor units",
        400,
        { code: "INVALID_AMOUNT" },
      );
    }
    requestedReleaseMinor = parsedMajor;
  } else if (input.releaseMinor != null) {
    requestedReleaseMinor = Math.max(0, Math.floor(input.releaseMinor));
  }

  const wantsRelease =
    input.resolution === "RESOLVED_SELLER" ||
    (input.resolution === "RESOLVED_SPLIT" &&
      (typedRelease ? requestedReleaseMinor > 0 : Boolean(input.releaseRemaining)));

  if (wantsRelease) {
    if (["REFUNDED", "CANCELLED", "FAILED", "RELEASED"].includes(working.status)) {
      throwHttp(
        `Cannot release residual from status ${working.status}`,
        409,
        { code: "INVALID_STATUS" },
      );
    }

    const booksBeforeRelease = booksForTxn(working);
    if (
      typedRelease &&
      requestedReleaseMinor > booksBeforeRelease.finalResidualMinor
    ) {
      throwHttp(
        `Sourcer release cannot exceed remaining entitlement (${booksBeforeRelease.finalResidualMinor} minor units)`,
        409,
        {
          code: "RELEASE_EXCEEDS_RESIDUAL",
          finalResidualMinor: booksBeforeRelease.finalResidualMinor,
        },
      );
    }
    if (
      typedRelease &&
      requestedReleaseMinor <= 0 &&
      input.resolution === "RESOLVED_SELLER"
    ) {
      throwHttp("Enter a sourcer release amount greater than zero", 400, {
        code: "INVALID_AMOUNT",
      });
    }

    const st = working.status as ProtectedStatus;
    if (st !== "READY_TO_RELEASE" && st !== "PARTIALLY_REFUNDED") {
      if (canTransition(st, "BUYER_RELEASE_NOW")) {
        working = await prisma.protectedTransaction.update({
          where: { id: working.id },
          data: {
            status: nextStatus(st, "BUYER_RELEASE_NOW"),
            inspectionEndsAt: null,
          },
        });
      } else if (canTransition(st, "COMPLETE_INSPECTION")) {
        working = await prisma.protectedTransaction.update({
          where: { id: working.id },
          data: {
            status: nextStatus(st, "COMPLETE_INSPECTION"),
          },
        });
      } else {
        working = await prisma.protectedTransaction.update({
          where: { id: working.id },
          data: { status: "READY_TO_RELEASE", inspectionEndsAt: null },
        });
      }
    }

    const { releaseFinal } = await import("@/lib/payments/release");
    const result = await releaseFinal({
      protectedTxnId: working.id,
      actorUserId: input.adminUserId,
      ...(typedRelease ? { amountMinor: requestedReleaseMinor } : {}),
    });
    released = !result.alreadyReleased;
    transferId = result.transferId ?? null;
    releaseAppliedMinor = result.amountMinor ?? 0;
    working =
      (await prisma.protectedTransaction.findUnique({
        where: { id: working.id },
      })) ?? working;
  }

  await recordAuditEvent({
    protectedTxnId: txn.id,
    actorUserId: input.adminUserId,
    action: input.auditAction,
    reason: input.resolutionNote,
    meta: {
      resolution: input.resolution,
      refundAppliedMinor,
      releaseAppliedMinor,
      released,
      transferId,
      refundId,
      booksAtResolve: {
        finalResidualMinor: booksAtStart.finalResidualMinor,
        refundableMinor: booksAtStart.refundableMinor,
        procurementTransferredMinor: booksAtStart.procurementTransferredMinor,
        platformFeeMinor: booksAtStart.platformFeeMinor,
      },
      ...(input.auditMeta || {}),
    },
  });

  return {
    working,
    refundAppliedMinor,
    releaseAppliedMinor,
    released,
    transferId,
    refundId,
    booksAtStart,
  };
}
