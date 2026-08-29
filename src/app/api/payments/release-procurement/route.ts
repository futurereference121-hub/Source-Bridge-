import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/validation";
import { prisma } from "@/lib/db";
import { assertPaymentsTestAllowlisted } from "@/lib/payments/allowlist";
import {
  isProcurementAdvancesEnabled,
  isProtectedPaymentsEnabled,
} from "@/lib/payments/flags";
import { releaseProcurement } from "@/lib/payments/release";
import { computeProtectedFinancials } from "@/lib/payments/breakdown";
import { formatMinor } from "@/lib/payments/money";
import { isDirectPaymentOption } from "@/lib/payments/payment-option";
import { getPaymentTicket } from "@/lib/payments/tickets";

export const runtime = "nodejs";

const schema = z.object({
  protectedTxnId: z.string().trim().min(1),
});

/**
 * Buyer-authorized procurement advance release (item cost only).
 * PROCUREMENT_ADVANCES_ENABLED = manual buyer release available — NOT auto-on-fund.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();

    if (!isProtectedPaymentsEnabled()) {
      return jsonError("Protected Payments are not enabled", 503);
    }
    if (!isProcurementAdvancesEnabled()) {
      return jsonError(
        "Procurement advances are not enabled (manual buyer release is gated off)",
        503,
        { code: "PROCUREMENT_DISABLED" },
      );
    }

    const body = await req.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }

    const txn = await prisma.protectedTransaction.findUnique({
      where: { id: parsed.data.protectedTxnId },
      include: {
        paymentTicket: { select: { id: true, status: true } },
        buyer: { select: { id: true, email: true } },
        seller: { select: { id: true, email: true } },
      },
    });
    if (!txn) return jsonError("Transaction not found", 404);

    // Buyer only.
    if (user.id !== txn.buyerId) {
      return jsonError("Only the buyer can release item funds", 403, {
        code: "BUYER_ONLY",
      });
    }

    assertPaymentsTestAllowlisted(
      [
        { id: txn.buyer.id, email: txn.buyer.email },
        { id: txn.seller.id, email: txn.seller.email },
      ],
      {
        action: "release procurement advance",
        labels: ["buyer", "seller"],
      },
    );

    // PROTECTED + funded + procurement path only. No Destination Charges.
    if (isDirectPaymentOption(txn.paymentOption)) {
      return jsonError(
        "Procurement release is not available for Direct Payment",
        409,
        { code: "DIRECT_NO_PROCUREMENT" },
      );
    }
    if (txn.status !== "FUNDED") {
      if (
        txn.status === "PROCUREMENT_RELEASED" ||
        txn.procurementTransferredMinor >= txn.procurementAdvanceMinor
      ) {
        const books = computeProtectedFinancials(txn);
        return Response.json({
          ok: true,
          alreadyReleased: true,
          transaction: {
            id: txn.id,
            status: txn.status,
            procurementTransferredMinor: txn.procurementTransferredMinor,
            books,
          },
        });
      }
      return jsonError(
        `Cannot release item funds from status ${txn.status}`,
        409,
        { code: "INVALID_STATUS" },
      );
    }

    if (!txn.procurementAdvanceAgreed || txn.procurementAdvanceMinor <= 0) {
      return jsonError("No procurement advance on this transaction", 400, {
        code: "NO_PROCUREMENT",
      });
    }
    if (txn.procurementTransferredMinor > 0) {
      return jsonError("Procurement advance already transferred", 409, {
        code: "ALREADY_TRANSFERRED",
      });
    }
    if (
      ["REFUNDED", "PARTIALLY_REFUNDED", "DISPUTED", "CANCELLED", "RELEASED"].includes(
        txn.status,
      )
    ) {
      return jsonError(`Cannot release from ${txn.status}`, 409);
    }

    // Eligible sourcing / payment-ticket flow (CHAT_TICKET or linked ticket).
    const eligibleOrigin =
      txn.origin === "CHAT_TICKET" ||
      Boolean(txn.paymentTicket) ||
      Boolean(txn.sourcingRequestId);
    if (!eligibleOrigin) {
      return jsonError(
        "Procurement release is only available for sourcing Payment Ticket flows",
        409,
        { code: "NOT_ELIGIBLE_FLOW" },
      );
    }

    const result = await releaseProcurement({
      protectedTxnId: txn.id,
      actorUserId: user.id,
    });

    const fresh = result.txn;
    const books = computeProtectedFinancials(fresh);
    const activityVersion =
      "activityVersion" in result ? result.activityVersion ?? 0 : 0;
    const linkedTicketId =
      "linkedTicketId" in result ? result.linkedTicketId ?? null : null;

    let ticket = null;
    const ticketId = linkedTicketId ?? txn.paymentTicket?.id ?? null;
    if (ticketId) {
      try {
        ticket = await getPaymentTicket(ticketId, user.id);
      } catch (err) {
        console.error("[payments:release-procurement:ticket]", err);
      }
    }

    return Response.json({
      ok: true,
      alreadyReleased: result.alreadyReleased,
      transferId: "transferId" in result ? result.transferId : undefined,
      activityVersion,
      ticket,
      message: result.alreadyReleased
        ? "Item funds were already released"
        : `Item funds released (${formatMinor(txn.procurementAdvanceMinor, txn.currency)}). Shipping and remaining amounts stay protected until delivery.`,
      transaction: {
        id: fresh.id,
        status: fresh.status,
        procurementTransferredMinor: fresh.procurementTransferredMinor,
        procurementReleasedAt:
          fresh.procurementReleasedAt?.toISOString() ?? null,
        books,
      },
    });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : "Failed";
    const code = (err as { code?: string }).code;
    if (status === 401) return jsonError("Sign in required", 401);
    if (status >= 400 && status < 500) {
      return jsonError(message, status, code ? { code } : undefined);
    }
    // Transfer failure — leave FUNDED; clear message for UI.
    console.error("[payments:release-procurement]", err);
    return jsonError(
      "Could not release item funds. Your payment remains fully protected on the platform — try again later or contact support.",
      502,
      { code: "PROCUREMENT_TRANSFER_FAILED", statusStays: "FUNDED" },
    );
  }
}
