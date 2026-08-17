import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/validation";
import { confirmReceipt } from "@/lib/payments/fulfilment";
import { formatMinor } from "@/lib/payments/money";
import { computeProtectedFinancials } from "@/lib/payments/breakdown";

export const runtime = "nodejs";

const schema = z.object({
  protectedTxnId: z.string().trim().min(1),
  /**
   * Protected receipt decision.
   * ACKNOWLEDGE = confirm received only.
   * Then RELEASE_NOW | START_INSPECTION.
   * REPORT_ISSUE only while IN_INSPECTION.
   */
  decision: z
    .enum(["ACKNOWLEDGE", "RELEASE_NOW", "START_INSPECTION", "REPORT_ISSUE"])
    .optional()
    .default("ACKNOWLEDGE"),
  reason: z.string().trim().min(3).max(200).optional(),
  category: z.string().trim().max(120).optional(),
  details: z.string().trim().max(4000).optional(),
});

/**
 * Buyer confirms item received for Protected Payments:
 * ACKNOWLEDGE (receipt only), then RELEASE_NOW | START_INSPECTION,
 * REPORT_ISSUE (during inspection only).
 * Never used for Direct Payment money paths.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }

    if (
      parsed.data.decision === "REPORT_ISSUE" &&
      !(parsed.data.reason && parsed.data.reason.trim().length >= 3)
    ) {
      return jsonError("Issue reason is required (min 3 characters)", 400);
    }

    const result = await confirmReceipt({
      protectedTxnId: parsed.data.protectedTxnId,
      buyerId: user.id,
      buyerEmail: user.email,
      decision: parsed.data.decision,
      reason: parsed.data.reason,
      category: parsed.data.category,
      details: parsed.data.details,
    });

    const t = result.transaction as {
      id: string;
      status: string;
      inspectionEndsAt: Date | null;
      deliveredAt: Date | null;
      releasedAt?: Date | null;
      totalChargeMinor: number;
      currency: string;
      itemCostMinor?: number;
      shippingMinor?: number;
      sellerServiceFeeMinor?: number;
      protectionFeeMinor?: number;
      procurementAdvanceAgreed?: boolean;
      procurementAdvanceMinor?: number;
      procurementTransferredMinor?: number;
      finalTransferredMinor?: number;
      refundedMinor?: number;
    };

    const books =
      typeof t.itemCostMinor === "number" &&
      typeof t.shippingMinor === "number" &&
      typeof t.sellerServiceFeeMinor === "number" &&
      typeof t.protectionFeeMinor === "number"
        ? computeProtectedFinancials({
            itemCostMinor: t.itemCostMinor,
            shippingMinor: t.shippingMinor,
            sellerServiceFeeMinor: t.sellerServiceFeeMinor,
            protectionFeeMinor: t.protectionFeeMinor,
            totalChargeMinor: t.totalChargeMinor,
            procurementAdvanceAgreed: t.procurementAdvanceAgreed,
            procurementAdvanceMinor: t.procurementAdvanceMinor,
            procurementTransferredMinor: t.procurementTransferredMinor,
            finalTransferredMinor: t.finalTransferredMinor,
            refundedMinor: t.refundedMinor,
          })
        : null;

    return Response.json({
      ok: true,
      alreadyConfirmed: result.alreadyConfirmed,
      decision: result.decision,
      transferTriggered: Boolean(result.transferTriggered),
      alreadyReleased: Boolean(
        (result as { alreadyReleased?: boolean }).alreadyReleased,
      ),
      transferId: (result as { transferId?: string | null }).transferId ?? null,
      dispute: (result as { dispute?: unknown }).dispute ?? null,
      transaction: {
        id: t.id,
        status: t.status,
        inspectionEndsAt: t.inspectionEndsAt?.toISOString?.() ?? t.inspectionEndsAt ?? null,
        deliveredAt: t.deliveredAt?.toISOString?.() ?? t.deliveredAt ?? null,
        releasedAt: t.releasedAt
          ? typeof t.releasedAt === "string"
            ? t.releasedAt
            : t.releasedAt.toISOString()
          : null,
        totalChargeMinor: t.totalChargeMinor,
        currency: t.currency,
        totalLabel: formatMinor(t.totalChargeMinor, t.currency),
        finalResidualMinor: books?.finalResidualMinor ?? null,
        procurementTransferredMinor: books?.procurementTransferredMinor ?? null,
        sellerEntitledMinor: books?.sellerEntitledMinor ?? null,
        platformFeeMinor: books?.platformFeeMinor ?? null,
        protectedRemainingMinor: books?.protectedRemainingMinor ?? null,
      },
    });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : "Failed";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[payments:confirm-receipt]", err);
    return jsonError("Could not confirm receipt", 500);
  }
}
