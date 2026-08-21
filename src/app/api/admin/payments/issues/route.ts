import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/validation";
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
import { isPaymentsEnabled } from "@/lib/payments/flags";
import { isDirectPaymentOption } from "@/lib/payments/payment-option";

export const runtime = "nodejs";

const resolveSchema = z.object({
  disputeId: z.string().trim().min(1),
  resolution: z.enum([
    "RESOLVED_SELLER",
    "RESOLVED_BUYER",
    "RESOLVED_SPLIT",
    "CLOSED",
  ]),
  resolutionNote: z.string().trim().max(2000).optional(),
  refundMinor: z.number().int().nonnegative().optional(),
  refundMajor: z.string().trim().max(32).optional(),
  releaseMinor: z.number().int().nonnegative().optional(),
  releaseMajor: z.string().trim().max(32).optional(),
  /** When true, buyer refund may include remaining SB platform fee on platform. */
  includePlatformFeeInRefund: z.boolean().optional().default(false),
  /** @deprecated Prefer releaseMinor. True = remaining residual only when no typed amount. */
  releaseRemaining: z.boolean().optional().default(false),
  confirmed: z.literal(true),
});

function booksForTxn(txn: {
  itemCostMinor: number;
  shippingMinor: number;
  sellerServiceFeeMinor: number;
  protectionFeeMinor: number;
  totalChargeMinor: number;
  procurementAdvanceAgreed: boolean;
  procurementAdvanceMinor: number;
  procurementTransferredMinor: number;
  finalTransferredMinor: number;
  refundedMinor: number;
}) {
  return computeProtectedFinancials(txn);
}

/** Admin-only open payment issues queue with financial breakdown. */
export async function GET() {
  try {
    await requireAdmin();

    const open = await prisma.disputeCase.findMany({
      where: { status: { in: ["OPEN", "UNDER_REVIEW"] } },
      orderBy: { createdAt: "asc" },
      take: 100,
      include: {
        protectedTxn: {
          select: {
            id: true,
            status: true,
            paymentOption: true,
            origin: true,
            title: true,
            currency: true,
            totalChargeMinor: true,
            itemCostMinor: true,
            shippingMinor: true,
            sellerServiceFeeMinor: true,
            protectionFeeMinor: true,
            procurementAdvanceAgreed: true,
            procurementAdvanceMinor: true,
            procurementTransferredMinor: true,
            finalTransferredMinor: true,
            refundedMinor: true,
            stripeMode: true,
            buyerId: true,
            sellerId: true,
            conversationId: true,
            paymentTicket: { select: { id: true } },
          },
        },
        openedBy: {
          select: { id: true, username: true, name: true, email: true },
        },
      },
    });

    const issues = open.map((d) => {
      const t = d.protectedTxn;
      const books = booksForTxn(t);
      return {
        disputeId: d.id,
        status: d.status,
        reason: d.reason,
        details: d.details,
        createdAt: d.createdAt.toISOString(),
        openedBy: d.openedBy,
        transaction: {
          id: t.id,
          status: t.status,
          paymentOption: t.paymentOption,
          origin: t.origin,
          title: t.title,
          currency: t.currency,
          stripeMode: t.stripeMode,
          conversationId: t.conversationId,
          paymentTicketId: t.paymentTicket?.id ?? null,
          isDirect: isDirectPaymentOption(t.paymentOption),
          books: {
            grossFundedMinor: books.grossFundedMinor,
            sellerEntitledMinor: books.sellerEntitledMinor,
            platformFeeMinor: books.platformFeeMinor,
            procurementTransferredMinor: books.procurementTransferredMinor,
            finalTransferredMinor: books.finalTransferredMinor,
            finalResidualMinor: books.finalResidualMinor,
            protectedRemainingMinor: books.protectedRemainingMinor,
            refundableMinor: books.refundableMinor,
            remainingProtectedSellerShareMinor:
              books.remainingProtectedSellerShareMinor,
          },
        },
      };
    });

    return Response.json({ ok: true, issues, count: issues.length });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    if (status === 403) return jsonError("Admin only", 403);
    console.error("[admin:payments:issues:list]", err);
    return jsonError("Failed to load payment issues", 500);
  }
}

/**
 * Admin resolve OPEN payment issue.
 * - RESOLVED_SELLER: sourcer release (typed amount or remaining residual)
 * - RESOLVED_BUYER: buyer refund via original PI/Charge (typed amount or remaining)
 * - RESOLVED_SPLIT: controlled refund + optional sourcer release, both bounded
 * Buyer never needs Connect. Sourcer destination is that sourcer's Connect account.
 */
export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    if (!isPaymentsEnabled()) return jsonError("Payments disabled", 503);

    const body = await req.json();
    const parsed = resolveSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }

    const dispute = await prisma.disputeCase.findUnique({
      where: { id: parsed.data.disputeId },
      include: { protectedTxn: true },
    });
    if (!dispute) return jsonError("Dispute not found", 404);
    if (!["OPEN", "UNDER_REVIEW"].includes(dispute.status)) {
      return jsonError(`Dispute already ${dispute.status}`, 409, {
        code: "NOT_OPEN",
      });
    }

    const txn = dispute.protectedTxn;
    if (isDirectPaymentOption(txn.paymentOption)) {
      return jsonError("Direct Payment issues are not resolved on this path", 409, {
        code: "DIRECT_NOT_SUPPORTED",
      });
    }
    if (txn.status === "RELEASED") {
      return jsonError(
        "Transaction already completed — cannot reopen money movement",
        409,
        { code: "ALREADY_RELEASED" },
      );
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

    // Buyer refund via original PaymentIntent/Charge — buyer does not need Connect.
    if (
      parsed.data.resolution === "RESOLVED_BUYER" ||
      parsed.data.resolution === "RESOLVED_SPLIT"
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
      const maxRefundable = parsed.data.includePlatformFeeInRefund
        ? books.refundableMinor
        : maxRefundExcludingFee;
      const typedRefund =
        Boolean(parsed.data.refundMajor) || parsed.data.refundMinor != null;
      let requested = 0;
      if (parsed.data.refundMajor) {
        const parsedMajor = parseHumanAmountToMinor(
          parsed.data.refundMajor,
          working.currency,
        );
        if (parsedMajor == null) {
          return jsonError(
            "Enter a valid currency amount (e.g. 50.00), not minor units",
            400,
            { code: "INVALID_AMOUNT" },
          );
        }
        requested = parsedMajor;
      } else if (parsed.data.refundMinor != null) {
        requested = Math.max(0, Math.floor(parsed.data.refundMinor));
      } else if (parsed.data.resolution === "RESOLVED_BUYER") {
        requested = books.refundableMinor;
      }

      if (
        typedRefund &&
        requested > maxRefundable
      ) {
        return jsonError(
          `Refund capped at ${maxRefundable} minor units${parsed.data.includePlatformFeeInRefund ? "" : " (SB fee excluded — check include fee)"}`,
          409,
          {
            code: "REFUND_EXCEEDS_PLATFORM",
            refundableMinor: maxRefundable,
          },
        );
      }

      if (requested > 0) {
        if (!isStripeConfigured() || !working.stripePaymentIntentId) {
          return jsonError("Cannot refund without Stripe payment", 409, {
            code: "STRIPE_REQUIRED",
          });
        }
        const plan = planProtectedRefund({
          ...working,
          status: working.status,
          requestedMinor: requested,
        });
        if (plan.amountMinor <= 0) {
          return jsonError(
            plan.blockedReason || "No safe refundable amount",
            409,
            {
              code: "REFUND_NOT_SAFE",
              refundableMinor: plan.refundableMinor,
            },
          );
        }
        if (requested > plan.refundableMinor) {
          return jsonError(
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
              disputeId: dispute.id,
              protectedTxnId: working.id,
              adminResolution: parsed.data.resolution,
            },
          },
          {
            idempotencyKey: `admin_refund_${dispute.id}_${plan.amountMinor}`,
          },
        );
        const feePortion = parsed.data.includePlatformFeeInRefund
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
      } else if (parsed.data.resolution === "RESOLVED_BUYER") {
        return jsonError("Nothing left on platform to refund to buyer", 409, {
          code: "NOTHING_REFUNDABLE",
          refundableMinor: books.refundableMinor,
        });
      }
    }

    // Sourcer release to that sourcer's Connect account (typed amount or residual).
    const typedRelease =
      Boolean(parsed.data.releaseMajor) || parsed.data.releaseMinor != null;
    let requestedReleaseMinor = 0;
    if (parsed.data.releaseMajor) {
      const parsedMajor = parseHumanAmountToMinor(
        parsed.data.releaseMajor,
        working.currency,
      );
      if (parsedMajor == null) {
        return jsonError(
          "Enter a valid sourcer release amount (e.g. 50.00), not minor units",
          400,
          { code: "INVALID_AMOUNT" },
        );
      }
      requestedReleaseMinor = parsedMajor;
    } else if (parsed.data.releaseMinor != null) {
      requestedReleaseMinor = Math.max(0, Math.floor(parsed.data.releaseMinor));
    }

    const wantsRelease =
      parsed.data.resolution === "RESOLVED_SELLER" ||
      (parsed.data.resolution === "RESOLVED_SPLIT" &&
        (typedRelease ? requestedReleaseMinor > 0 : parsed.data.releaseRemaining));

    if (wantsRelease) {
      if (["REFUNDED", "CANCELLED", "FAILED", "RELEASED"].includes(working.status)) {
        return jsonError(
          `Cannot release residual from status ${working.status}`,
          409,
          { code: "INVALID_STATUS" },
        );
      }

      const booksBeforeRelease = booksForTxn(working);
      if (typedRelease && requestedReleaseMinor > booksBeforeRelease.finalResidualMinor) {
        return jsonError(
          `Sourcer release cannot exceed remaining entitlement (${booksBeforeRelease.finalResidualMinor} minor units)`,
          409,
          {
            code: "RELEASE_EXCEEDS_RESIDUAL",
            finalResidualMinor: booksBeforeRelease.finalResidualMinor,
          },
        );
      }
      if (typedRelease && requestedReleaseMinor <= 0 && parsed.data.resolution === "RESOLVED_SELLER") {
        return jsonError("Enter a sourcer release amount greater than zero", 400, {
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
          // Admin residual path when books still show residual.
          working = await prisma.protectedTransaction.update({
            where: { id: working.id },
            data: { status: "READY_TO_RELEASE", inspectionEndsAt: null },
          });
        }
      }

      const { releaseFinal } = await import("@/lib/payments/release");
      const result = await releaseFinal({
        protectedTxnId: working.id,
        actorUserId: admin.id,
        ...(typedRelease ? { amountMinor: requestedReleaseMinor } : {}),
      });
      released = !result.alreadyReleased;
      transferId = result.transferId ?? null;
      releaseAppliedMinor = result.amountMinor ?? 0;
    }

    const updated = await prisma.disputeCase.update({
      where: { id: dispute.id },
      data: {
        status: parsed.data.resolution,
        resolutionNote: parsed.data.resolutionNote || "",
        resolvedById: admin.id,
        resolvedAt: new Date(),
      },
    });

    await recordAuditEvent({
      protectedTxnId: txn.id,
      actorUserId: admin.id,
      action: "ADMIN_RESOLVE_PAYMENT_ISSUE",
      reason: parsed.data.resolutionNote,
      meta: {
        disputeId: dispute.id,
        resolution: parsed.data.resolution,
        refundAppliedMinor,
        releaseAppliedMinor,
        released,
        transferId,
        booksAtResolve: {
          finalResidualMinor: booksAtStart.finalResidualMinor,
          refundableMinor: booksAtStart.refundableMinor,
          procurementTransferredMinor: booksAtStart.procurementTransferredMinor,
          platformFeeMinor: booksAtStart.platformFeeMinor,
        },
      },
    });

    if (txn.conversationId) {
      void import("@/lib/payment-notifications").then(({ notifyDisputeResolved }) =>
        notifyDisputeResolved({
          disputeId: dispute.id,
          conversationId: txn.conversationId || "",
          buyerId: txn.buyerId,
          sellerId: txn.sellerId,
          resolution: parsed.data.resolution,
        }),
      );
    }

    return Response.json({
      ok: true,
      dispute: updated,
      refundAppliedMinor,
      releaseAppliedMinor,
      released,
      transferId,
      refundId,
    });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : "Failed";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status === 403) return jsonError("Admin only", 403);
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[admin:payments:issues:resolve]", err);
    return jsonError("Failed to resolve payment issue", 500);
  }
}

