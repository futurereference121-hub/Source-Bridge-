import { requireSessionUser } from "@/lib/auth";
import { endLiveSession } from "@/lib/live/sessions";
import { jsonError } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSessionUser();
    const { id } = await ctx.params;
    const session = await endLiveSession({
      sessionId: id,
      reason: "BROADCASTER",
      actorUserId: user.id,
    });
    return Response.json({ ok: true, session });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : "Could not end Live";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[live:end]", err);
    return jsonError(message, 500);
  }
}
