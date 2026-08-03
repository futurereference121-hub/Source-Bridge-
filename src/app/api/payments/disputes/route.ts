import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/validation";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/payments/ledger";
import {
  canTransition,
  nextStatus,
  type ProtectedStatus,
} from "@/lib/payments/state-machine";
import { getStripe, isStripeConfigured } from "@/lib/payments/stripe/client";
import { appendLedgerEntry } from "@/lib/payments/ledger";
import { isPaymentsEnabled } from "@/lib/payments/flags";

export const runtime = "nodejs";

const openSchema = z.object({
  protectedTxnId: z.string().trim().min(1),
  reason: z.string().trim().min(3).max(200),
  details: z.string().trim().max(4000).optional(),
});

const resolveSchema = z.object({
  disputeId: z.string().trim().min(1),
  resolution: z.enum([
    "RESOLVED_BUYER",
    "RESOLVED_SELLER",
    "RESOLVED_SPLIT",
    "CLOSED",
  ]),
  resolutionNote: z.string().trim().max(2000).optional(),
  refundMinor: z.number().int().nonnegative().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body = await req.json();
    const parsed = openSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }

    const txn = await prisma.protectedTransaction.findUnique({
      where: { id: parsed.data.protectedTxnId },
    });
    if (!txn) return jsonError("Transaction not found", 404);
    if (user.id !== txn.buyerId && user.id !== txn.sellerId) {
      return jsonError("Not a party", 403);
    }

    const status = txn.status as ProtectedStatus;
    if (!canTransition(status, "OPEN_DISPUTE")) {
      return jsonError(`Cannot open dispute from ${status}`, 409);
    }

    const dispute = await prisma.$transaction(async (tx) => {
      const d = await tx.disputeCase.create({
        data: {
          protectedTxnId: txn.id,
          openedById: user.id,
          reason: parsed.data.reason,
          details: parsed.data.details || "",
          status: "OPEN",
        },
      });
      await tx.protectedTransaction.update({
        where: { id: txn.id },
        data: { status: nextStatus(status, "OPEN_DISPUTE") },
      });
      return d;
    });

    await recordAuditEvent({
      protectedTxnId: txn.id,
      actorUserId: user.id,
      action: "OPEN_DISPUTE",
      reason: parsed.data.reason,
      meta: { disputeId: dispute.id },
    });

    return Response.json({ ok: true, dispute }, { status: 201 });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[payments:disputes:open]", err);
    return jsonError("Failed to open dispute", 500);
  }
}

/** Admin resolve — also used later from admin financial UI. */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (user.role !== "ADMIN" && !user.isAdmin) {
      return jsonError("Admin only", 403);
    }
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

    const txn = dispute.protectedTxn;
    const status = txn.status as ProtectedStatus;

    if (parsed.data.refundMinor && parsed.data.refundMinor > 0) {
      if (!isStripeConfigured() || !txn.stripePaymentIntentId) {
        return jsonError("Cannot refund without Stripe payment", 409);
      }
      const stripe = getStripe();
      const refund = await stripe.refunds.create(
        {
          payment_intent: txn.stripePaymentIntentId,
          amount: parsed.data.refundMinor,
          metadata: { disputeId: dispute.id, protectedTxnId: txn.id },
        },
        { idempotencyKey: `refund_${dispute.id}_${parsed.data.refundMinor}` },
      );
      await appendLedgerEntry({
        protectedTxnId: txn.id,
        entryType: "REFUND",
        direction: "DEBIT",
        amountMinor: parsed.data.refundMinor,
        currency: txn.currency,
        idempotencyKey: `ledger_refund_${refund.id}`,
        stripeObjectId: refund.id,
        stripeObjectType: "refund",
      });
      await prisma.protectedTransaction.update({
        where: { id: txn.id },
        data: {
          refundedMinor: txn.refundedMinor + parsed.data.refundMinor,
          status:
            parsed.data.refundMinor >= txn.totalChargeMinor
              ? "REFUNDED"
              : "PARTIALLY_REFUNDED",
        },
      });
    } else if (canTransition(status, "RESOLVE_DISPUTE")) {
      await prisma.protectedTransaction.update({
        where: { id: txn.id },
        data: { status: nextStatus(status, "RESOLVE_DISPUTE") },
      });
    }

    const updated = await prisma.disputeCase.update({
      where: { id: dispute.id },
      data: {
        status: parsed.data.resolution,
        resolutionNote: parsed.data.resolutionNote || "",
        resolvedById: user.id,
        resolvedAt: new Date(),
      },
    });

    await recordAuditEvent({
      protectedTxnId: txn.id,
      actorUserId: user.id,
      action: "RESOLVE_DISPUTE",
      reason: parsed.data.resolutionNote,
      meta: {
        disputeId: dispute.id,
        resolution: parsed.data.resolution,
        refundMinor: parsed.data.refundMinor || 0,
      },
    });

    return Response.json({ ok: true, dispute: updated });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[payments:disputes:resolve]", err);
    return jsonError("Failed to resolve dispute", 500);
  }
}
