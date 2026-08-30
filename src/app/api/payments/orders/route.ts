import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/validation";
import {
  getProtectedOrderForUser,
  listProtectedOrdersForUser,
} from "@/lib/payments/fulfilment";
import { getOrdersListVersion } from "@/lib/payments/order-list-version";

export const runtime = "nodejs";

const querySchema = z.object({
  role: z.enum(["buyer", "seller"]),
  sinceVersion: z.coerce.number().int().nonnegative().optional(),
  txnId: z.string().trim().min(1).optional(),
});

/**
 * List Protected Transactions for the signed-in user as buyer or seller.
 * Supports soft-poll via sinceVersion (max updatedAt ms) and single-order fetch via txnId.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const parsed = querySchema.safeParse({
      role: req.nextUrl.searchParams.get("role") || "",
      sinceVersion: req.nextUrl.searchParams.get("sinceVersion") ?? undefined,
      txnId: req.nextUrl.searchParams.get("txnId") ?? undefined,
    });
    if (!parsed.success) {
      return jsonError("role must be buyer or seller", 400);
    }

    if (parsed.data.txnId) {
      const order = await getProtectedOrderForUser({
        userId: user.id,
        email: user.email,
        protectedTxnId: parsed.data.txnId,
      });
      const ordersVersion = await getOrdersListVersion(user.id, parsed.data.role);
      return Response.json({
        ok: true,
        role: parsed.data.role,
        order,
        ordersVersion,
      });
    }

    const ordersVersion = await getOrdersListVersion(user.id, parsed.data.role);
    if (
      parsed.data.sinceVersion != null &&
      parsed.data.sinceVersion >= ordersVersion
    ) {
      return Response.json({
        ok: true,
        unchanged: true,
        role: parsed.data.role,
        ordersVersion,
      });
    }

    const orders = await listProtectedOrdersForUser({
      userId: user.id,
      email: user.email,
      role: parsed.data.role,
    });
    return Response.json({
      ok: true,
      role: parsed.data.role,
      orders,
      ordersVersion,
    });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : "Failed";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[payments:orders]", err);
    return jsonError("Failed to load orders", 500);
  }
}
