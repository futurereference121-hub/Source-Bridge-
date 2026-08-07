import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/validation";
import { confirmReceipt } from "@/lib/payments/fulfilment";
import { formatMinor } from "@/lib/payments/money";

export const runtime = "nodejs";

const schema = z.object({
  protectedTxnId: z.string().trim().min(1),
});

/**
 * Buyer confirms item received → IN_INSPECTION only (no Stripe Transfer).
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }

    const result = await confirmReceipt({
      protectedTxnId: parsed.data.protectedTxnId,
      buyerId: user.id,
      buyerEmail: user.email,
    });

    const t = result.transaction;
    return Response.json({
      ok: true,
      alreadyConfirmed: result.alreadyConfirmed,
      transferTriggered: false,
      transaction: {
        id: t.id,
        status: t.status,
        inspectionEndsAt: t.inspectionEndsAt?.toISOString() ?? null,
        deliveredAt: t.deliveredAt?.toISOString() ?? null,
        totalChargeMinor: t.totalChargeMinor,
        currency: t.currency,
        totalLabel: formatMinor(t.totalChargeMinor, t.currency),
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
