import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/validation";
import { computeProtectedFinancials } from "@/lib/payments/breakdown";
import { isPaymentsEnabled } from "@/lib/payments/flags";
import { isDirectPaymentOption } from "@/lib/payments/payment-option";
import { executeAdminProtectedMoneyDecision } from "@/lib/payments/admin-protected-decision";

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
  includePlatformFeeInRefund: z.boolean().optional().default(false),
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
    const money = await executeAdminProtectedMoneyDecision({
      txn,
      adminUserId: admin.id,
      resolution: parsed.data.resolution,
      resolutionNote: parsed.data.resolutionNote,
      refundMinor: parsed.data.refundMinor,
      refundMajor: parsed.data.refundMajor,
      releaseMinor: parsed.data.releaseMinor,
      releaseMajor: parsed.data.releaseMajor,
      includePlatformFeeInRefund: parsed.data.includePlatformFeeInRefund,
      releaseRemaining: parsed.data.releaseRemaining,
      idempotencyScope: dispute.id,
      auditAction: "ADMIN_RESOLVE_PAYMENT_ISSUE",
      auditMeta: { disputeId: dispute.id },
    });

    const updated = await prisma.disputeCase.update({
      where: { id: dispute.id },
      data: {
        status: parsed.data.resolution,
        resolutionNote: parsed.data.resolutionNote || "",
        resolvedById: admin.id,
        resolvedAt: new Date(),
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
      refundAppliedMinor: money.refundAppliedMinor,
      releaseAppliedMinor: money.releaseAppliedMinor,
      released: money.released,
      transferId: money.transferId,
      refundId: money.refundId,
    });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : "Failed";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status === 403) return jsonError("Admin only", 403);
    if (status >= 400 && status < 500) {
      const code = (err as { code?: string }).code;
      const refundableMinor = (err as { refundableMinor?: number }).refundableMinor;
      const finalResidualMinor = (err as { finalResidualMinor?: number })
        .finalResidualMinor;
      return jsonError(message, status, {
        ...(code ? { code } : {}),
        ...(refundableMinor != null ? { refundableMinor } : {}),
        ...(finalResidualMinor != null ? { finalResidualMinor } : {}),
      });
    }
    console.error("[admin:payments:issues:resolve]", err);
    return jsonError("Failed to resolve payment issue", 500);
  }
}
