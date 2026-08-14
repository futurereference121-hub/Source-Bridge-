import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/validation";
import { cancelPaymentTicket } from "@/lib/payments/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const cancelSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireSessionUser();
    const { id } = await ctx.params;
    let reason: string | undefined;
    try {
      const body = await req.json();
      const parsed = cancelSchema.safeParse(body ?? {});
      if (parsed.success) reason = parsed.data.reason;
    } catch {
      // Empty body is fine.
    }
    const ticket = await cancelPaymentTicket({
      ticketId: id,
      actorId: user.id,
      reason,
    });
    return Response.json({ ok: true, ticket });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : "Failed";
    const code = (err as { code?: string }).code;
    if (status === 401) return jsonError("Sign in required", 401);
    if (status >= 400 && status < 500) {
      return jsonError(message, status, {
        ok: false,
        ...(code ? { code } : {}),
      });
    }
    console.error("[payments:tickets:cancel]", err);
    return jsonError("Failed to cancel ticket", 500);
  }
}
