import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/validation";
import {
  deletePaymentTicket,
  getPaymentTicket,
  respondToPaymentTicket,
} from "@/lib/payments/tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const respondSchema = z.object({
  action: z.enum(["accept", "decline"]),
  reason: z.string().trim().max(500).optional(),
  expectedRevision: z.number().int().positive().optional(),
});

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireSessionUser();
    const { id } = await ctx.params;
    const ticket = await getPaymentTicket(id, user.id);
    return Response.json(
      { ok: true, ticket },
      {
        headers: {
          "Cache-Control": "private, no-store, no-cache, must-revalidate",
        },
      },
    );
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : "Failed";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[payments:tickets:get]", err);
    return jsonError("Failed to load ticket", 500);
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireSessionUser();
    const { id } = await ctx.params;
    const body = await req.json();
    const parsed = respondSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }
    const ticket = await respondToPaymentTicket({
      ticketId: id,
      actorId: user.id,
      action: parsed.data.action,
      reason: parsed.data.reason,
      expectedRevision: parsed.data.expectedRevision,
    });
    return Response.json({ ok: true, ticket });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : "Failed";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[payments:tickets:respond]", err);
    return jsonError("Failed to update ticket", 500);
  }
}

/** Safe hard-delete for unfunded PROPOSED tickets only. */
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireSessionUser();
    const { id } = await ctx.params;
    const result = await deletePaymentTicket({
      ticketId: id,
      actorId: user.id,
    });
    return Response.json({ ok: true, ...result });
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
    console.error("[payments:tickets:delete]", err);
    return jsonError("Failed to delete ticket", 500);
  }
}
