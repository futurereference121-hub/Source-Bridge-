import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/validation";
import { isPaymentsEnabled } from "@/lib/payments/flags";
import { isDirectPaymentOption } from "@/lib/payments/payment-option";
import { executeAdminProtectedMoneyDecision } from "@/lib/payments/admin-protected-decision";
import { bumpConversationActivity } from "@/lib/conversation-activity";

export const runtime = "nodejs";

const decisionSchema = z.object({
  protectedTxnId: z.string().trim().min(1),
  resolution: z.enum([
    "RESOLVED_SELLER",
    "RESOLVED_BUYER",
    "RESOLVED_SPLIT",
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

/**
 * Admin refund / release / split for Protected listing purchases WITHOUT an
 * open dispute. Same money rails as dispute resolve (PI refund + seller Connect).
 * Refuses Direct. Refuses when an OPEN/UNDER_REVIEW dispute exists (use issues).
 */
export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    if (!isPaymentsEnabled()) return jsonError("Payments disabled", 503);

    const body = await req.json();
    const parsed = decisionSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }

    const txn = await prisma.protectedTransaction.findUnique({
      where: { id: parsed.data.protectedTxnId },
    });
    if (!txn) return jsonError("Protected transaction not found", 404);
    if (isDirectPaymentOption(txn.paymentOption)) {
      return jsonError("Direct Payment is not resolved on this path", 409, {
        code: "DIRECT_NOT_SUPPORTED",
      });
    }

    const openDispute = await prisma.disputeCase.findFirst({
      where: {
        protectedTxnId: txn.id,
        status: { in: ["OPEN", "UNDER_REVIEW"] },
      },
      select: { id: true },
    });
    if (openDispute) {
      return jsonError(
        "Open item issue exists — resolve via Reviews / payment issues",
        409,
        { code: "OPEN_DISPUTE_EXISTS", disputeId: openDispute.id },
      );
    }

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
      idempotencyScope: `txn_${txn.id}`,
      auditAction: "ADMIN_PROTECTED_PURCHASE_DECISION",
      auditMeta: { protectedTxnId: txn.id, noDispute: true },
    });

    if (txn.conversationId) {
      await bumpConversationActivity(txn.conversationId).catch(() => null);
    }

    return Response.json({
      ok: true,
      protectedTxnId: txn.id,
      status: money.working.status,
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
    console.error("[admin:payments:protected-txns:decision]", err);
    return jsonError("Failed to apply protected purchase decision", 500);
  }
}
