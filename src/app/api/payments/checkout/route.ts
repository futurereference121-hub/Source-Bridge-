import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/validation";
import {
  checkoutPublicConfig,
  createPaymentIntentForTxn,
} from "@/lib/payments/checkout";
import { isPaymentsEnabled } from "@/lib/payments/flags";

export const runtime = "nodejs";

const schema = z.object({
  protectedTxnId: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(8).max(200),
});

export async function GET() {
  return Response.json({
    ok: true,
    paymentsEnabled: isPaymentsEnabled(),
    ...checkoutPublicConfig(),
  });
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (!isPaymentsEnabled()) {
      return jsonError("Payments are not enabled", 503);
    }
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }
    const result = await createPaymentIntentForTxn({
      protectedTxnId: parsed.data.protectedTxnId,
      buyerId: user.id,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    return Response.json({
      ok: true,
      clientSecret: result.clientSecret,
      paymentIntentId: result.paymentIntentId,
      publishableKey: result.publishableKey,
      amountMinor: result.amountMinor,
      currency: result.currency,
      chargeModel: checkoutPublicConfig().chargeModel,
    });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : "Checkout failed";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[payments:checkout]", err);
    return jsonError("Checkout failed", 500);
  }
}
