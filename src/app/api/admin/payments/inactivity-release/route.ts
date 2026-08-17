import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/validation";
import { computeProtectedFinancials } from "@/lib/payments/breakdown";
import { recordAuditEvent } from "@/lib/payments/ledger";
import {
  canTransition,
  nextStatus,
  type ProtectedStatus,
} from "@/lib/payments/state-machine";
import { isPaymentsEnabled } from "@/lib/payments/flags";
import {
  BUYER_INACTIVITY_ADMIN_RELEASE_MS,
  adminMayReleaseAfterBuyerInactivity,
} from "@/lib/payments/fulfilment-rules";

export const runtime = "nodejs";

const schema = z.object({
  protectedTxnId: z.string().trim().min(1),
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

/** Eligible listing sales waiting on buyer receipt past the inactivity window. */
export async function GET() {
  try {
    await requireAdmin();
    const now = new Date();
    const cutoff = new Date(now.getTime() - BUYER_INACTIVITY_ADMIN_RELEASE_MS);
    const rows = await prisma.protectedTransaction.findMany({
      where: {
        origin: "PRODUCT_CHECKOUT",
        paymentOption: "PROTECTED",
        status: { in: ["AWAITING_SHIPMENT", "IN_TRANSIT", "DELIVERED"] },
        shippedAt: { lte: cutoff },
        deliveredAt: null,
        releasedAt: null,
      },
      orderBy: { shippedAt: "asc" },
      take: 50,
      select: {
        id: true,
        status: true,
        origin: true,
        paymentOption: true,
        title: true,
        currency: true,
        shippedAt: true,
        deliveredAt: true,
        itemCostMinor: true,
        shippingMinor: true,
        sellerServiceFeeMinor: true,
        protectionFeeMinor: true,
        totalChargeMinor: true,
        procurementAdvanceAgreed: true,
        procurementAdvanceMinor: true,
        procurementTransferredMinor: true,
        finalTransferredMinor: true,
        refundedMinor: true,
        buyer: { select: { id: true, username: true, name: true } },
        seller: { select: { id: true, username: true, name: true } },
      },
    });
    const txnIds = rows.map((r) => r.id);
    const openDisputes =
      txnIds.length === 0
        ? []
        : await prisma.disputeCase.findMany({
            where: {
              protectedTxnId: { in: txnIds },
              status: { in: ["OPEN", "UNDER_REVIEW"] },
            },
            select: { protectedTxnId: true },
          });
    const disputed = new Set(openDisputes.map((d) => d.protectedTxnId));
    const eligible = rows
      .map((t) => {
        const books = booksForTxn(t);
        const gate = adminMayReleaseAfterBuyerInactivity({
          origin: t.origin,
          paymentOption: t.paymentOption,
          status: t.status,
          shippedAt: t.shippedAt,
          deliveredAt: t.deliveredAt,
          openDispute: disputed.has(t.id),
          remainingSellerShareMinor: books.finalResidualMinor,
          now,
        });
        return { t, books, gate };
      })
      .filter((x) => x.gate.ok)
      .map(({ t, books, gate }) => ({
        id: t.id,
        status: t.status,
        title: t.title,
        currency: t.currency,
        shippedAt: t.shippedAt?.toISOString() ?? null,
        windowEndsAt: gate.windowEndsAt?.toISOString() ?? null,
        residualMinor: books.finalResidualMinor,
        buyer: t.buyer,
        seller: t.seller,
      }));

    return Response.json({
      ok: true,
      windowMs: BUYER_INACTIVITY_ADMIN_RELEASE_MS,
      windowHours: BUYER_INACTIVITY_ADMIN_RELEASE_MS / (60 * 60 * 1000),
      count: eligible.length,
      eligible,
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    if (status === 403) return jsonError("Admin only", 403);
    console.error("[admin:inactivity-release:list]", err);
    return jsonError("Failed to load inactivity candidates", 500);
  }
}

/**
 * Admin-authorized residual release after buyer inactivity.
 * Does not grant sellers a self-release path.
 */
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    if (!isPaymentsEnabled()) return jsonError("Payments disabled", 503);

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }

    const txn = await prisma.protectedTransaction.findUnique({
      where: { id: parsed.data.protectedTxnId },
    });
    if (!txn) return jsonError("Transaction not found", 404);

    const openIssue = await prisma.disputeCase.findFirst({
      where: {
        protectedTxnId: txn.id,
        status: { in: ["OPEN", "UNDER_REVIEW"] },
      },
      select: { id: true },
    });
    const books = booksForTxn(txn);
    const gate = adminMayReleaseAfterBuyerInactivity({
      origin: txn.origin,
      paymentOption: txn.paymentOption,
      status: txn.status,
      shippedAt: txn.shippedAt,
      deliveredAt: txn.deliveredAt,
      openDispute: Boolean(openIssue),
      remainingSellerShareMinor: books.finalResidualMinor,
    });
    if (!gate.ok) {
      return jsonError(
        `Not eligible for inactivity release (${gate.code || "blocked"})`,
        409,
        { code: gate.code || "NOT_ELIGIBLE" },
      );
    }

    let working = txn;
    const st = working.status as ProtectedStatus;
    if (st !== "READY_TO_RELEASE") {
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
          data: { status: nextStatus(st, "COMPLETE_INSPECTION") },
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
      actorUserId: admin.id,
    });

    await recordAuditEvent({
      protectedTxnId: txn.id,
      actorUserId: admin.id,
      action: "ADMIN_INACTIVITY_RELEASE",
      meta: {
        windowMs: BUYER_INACTIVITY_ADMIN_RELEASE_MS,
        shippedAt: txn.shippedAt?.toISOString() ?? null,
        alreadyReleased: result.alreadyReleased,
        transferId: result.transferId ?? null,
      },
    });

    return Response.json({
      ok: true,
      alreadyReleased: result.alreadyReleased,
      transferId: result.transferId ?? null,
    });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : "Failed";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status === 403) return jsonError("Admin only", 403);
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[admin:inactivity-release]", err);
    return jsonError("Failed to authorize inactivity release", 500);
  }
}
