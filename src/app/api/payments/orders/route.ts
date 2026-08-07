import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/validation";
import { listProtectedOrdersForUser } from "@/lib/payments/fulfilment";

export const runtime = "nodejs";

const querySchema = z.object({
  role: z.enum(["buyer", "seller"]),
});

/**
 * List Protected Transactions for the signed-in user as buyer or seller.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const parsed = querySchema.safeParse({
      role: req.nextUrl.searchParams.get("role") || "",
    });
    if (!parsed.success) {
      return jsonError("role must be buyer or seller", 400);
    }
    const orders = await listProtectedOrdersForUser({
      userId: user.id,
      email: user.email,
      role: parsed.data.role,
    });
    return Response.json({ ok: true, role: parsed.data.role, orders });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : "Failed";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[payments:orders]", err);
    return jsonError("Failed to load orders", 500);
  }
}
