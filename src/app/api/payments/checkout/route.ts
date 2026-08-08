import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/validation";
import {
  checkoutPublicConfig,
  createPaymentIntentForTxn,
  getProtectedTxnPaymentStatus,
} from "@/lib/payments/checkout";
import { isPaymentsEnabled } from "@/lib/payments/flags";

export const runtime = "nodejs";

const schema = z.object({
  protectedTxnId: z.string().trim().min(1),
  idempotencyKey: z.string().trim().min(8).max(200),
});

export async function GET(req: NextRequest) {
  const publicConfig = {
    ok: true,
    paymentsEnabled: isPaymentsEnabled(),
    ...checkoutPublicConfig(),
  };

  const protectedTxnId = (req.nextUrl.searchParams.get("protectedTxnId") || "").trim();
  if (!protectedTxnId) {
    return Response.json(publicConfig);
  }

  try {
    const user = await requireSessionUser();
    if (!isPaymentsEnabled()) {
      return jsonError("Payments are not enabled", 503);
    }
    const status = await getProtectedTxnPaymentStatus({
      protectedTxnId,
      viewerUserId: user.id,
    });
    return Response.json({
      ok: true,
      transaction: status,
      paymentsEnabled: isPaymentsEnabled(),
      ...checkoutPublicConfig(),
    });
  } catch (err) {
    const code = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : "Failed";
    if (code === 401) return jsonError("Sign in required", 401);
    if (code >= 400 && code < 500) return jsonError(message, code);
    console.error("[payments:checkout:status]", err);
    return jsonError("Failed to load payment status", 500);
  }
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
      chargeModel: result.chargeModel,
      protectedTxnId: parsed.data.protectedTxnId,
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
