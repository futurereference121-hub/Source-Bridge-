import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/validation";
import { recordAuditEvent } from "@/lib/payments/ledger";

export const runtime = "nodejs";

const schema = z.object({
  disputeId: z.string().trim().min(1),
  status: z.enum(["UNDER_REVIEW"]),
  adminNotes: z.string().trim().max(4000).optional(),
});

/** Move an open payment issue into admin review (no money movement). */
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }

    const dispute = await prisma.disputeCase.findUnique({
      where: { id: parsed.data.disputeId },
      include: {
        protectedTxn: {
          select: {
            id: true,
            conversationId: true,
            buyerId: true,
            sellerId: true,
          },
        },
      },
    });
    if (!dispute) return jsonError("Dispute not found", 404);
    if (dispute.status !== "OPEN") {
      return jsonError(`Cannot review dispute in status ${dispute.status}`, 409);
    }

    const updated = await prisma.disputeCase.update({
      where: { id: dispute.id },
      data: {
        status: parsed.data.status,
        ...(parsed.data.adminNotes != null
          ? { adminNotes: parsed.data.adminNotes }
          : {}),
      },
    });

    await recordAuditEvent({
      protectedTxnId: dispute.protectedTxnId,
      actorUserId: admin.id,
      action: "ADMIN_DISPUTE_UNDER_REVIEW",
      meta: { disputeId: dispute.id },
    });

    const txn = dispute.protectedTxn;
    if (txn?.conversationId && txn.buyerId && txn.sellerId) {
      void import("@/lib/payment-notifications").then(
        ({ notifyDisputeUnderReview }) =>
          notifyDisputeUnderReview({
            disputeId: dispute.id,
            conversationId: txn.conversationId!,
            buyerId: txn.buyerId,
            sellerId: txn.sellerId,
          }),
      );
    }

    return Response.json({ ok: true, dispute: updated });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : "Failed";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status === 403) return jsonError("Admin only", 403);
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[admin:payments:issues:review]", err);
    return jsonError("Failed to update dispute", 500);
  }
}
