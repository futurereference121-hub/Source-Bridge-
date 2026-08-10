import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/validation";
import { computeProtectedFinancials } from "@/lib/payments/breakdown";
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
  releaseRemaining: z.boolean().optional().default(false),
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
      where: { status: "OPEN" },
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
 * - RESOLVED_SELLER: residual via releaseFinal only
 * - RESOLVED_BUYER: refund remaining platform-held (server-capped)
 * - RESOLVED_SPLIT: controlled refund (+ optional residual release), both bounded
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
    if (dispute.status !== "OPEN") {
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
    let released = false;
    let transferId: string | null = null;
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

    // Buyer refund (full remaining or controlled partial) — server clamps.
    if (
      parsed.data.resolution === "RESOLVED_BUYER" ||
      parsed.data.resolution === "RESOLVED_SPLIT"
    ) {
      const books = booksForTxn(working);
      const requested =
        parsed.data.resolution === "RESOLVED_BUYER"
          ? books.refundableMinor
          : Math.max(0, Math.floor(parsed.data.refundMinor ?? 0));

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
            status: plan.nextStatus,
          },
        });
        refundAppliedMinor = plan.amountMinor;
      } else if (parsed.data.resolution === "RESOLVED_BUYER") {
        return jsonError("Nothing left on platform to refund to buyer", 409, {
          code: "NOTHING_REFUNDABLE",
          refundableMinor: books.refundableMinor,
        });
      }
    }

    // Seller residual releaseFinal (full or post-partial remainder).
    if (
      parsed.data.resolution === "RESOLVED_SELLER" ||
      (parsed.data.resolution === "RESOLVED_SPLIT" &&
        parsed.data.releaseRemaining)
    ) {
      if (["REFUNDED", "CANCELLED", "FAILED", "RELEASED"].includes(working.status)) {
        return jsonError(
          `Cannot release residual from status ${working.status}`,
          409,
          { code: "INVALID_STATUS" },
        );
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
      });
      released = !result.alreadyReleased;
      transferId = result.transferId ?? null;
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

    return Response.json({
      ok: true,
      dispute: updated,
      refundAppliedMinor,
      released,
      transferId,
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

