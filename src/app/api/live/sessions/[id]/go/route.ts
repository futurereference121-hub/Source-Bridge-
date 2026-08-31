import { requireSessionUser } from "@/lib/auth";
import { goLiveSession } from "@/lib/live/sessions";
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
    const session = await goLiveSession({ user, sessionId: id });
    return Response.json({ ok: true, session });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const code = (err as { code?: string }).code;
    const message = err instanceof Error ? err.message : "Could not go Live";
    if (status === 401) return jsonError("Sign in required", 401, { code });
    if (status >= 400 && status < 500) return jsonError(message, status, { code });
    console.error("[live:go]", err);
    return jsonError(message, 500, { code });
  }
}
