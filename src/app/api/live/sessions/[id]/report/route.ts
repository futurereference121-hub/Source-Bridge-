import { requireSessionUser } from "@/lib/auth";
import { reportLiveSession } from "@/lib/live/reports";
import { jsonError } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSessionUser();
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      reason?: string;
      notes?: string;
    };
    const result = await reportLiveSession({
      user,
      sessionId: id,
      reason: body.reason || "",
      notes: body.notes,
    });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : "Could not report Live";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[live:report]", err);
    return jsonError(message, 500);
  }
}
