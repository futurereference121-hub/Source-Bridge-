import { requireSessionUser } from "@/lib/auth";
import { resumeLiveSession } from "@/lib/live/sessions";
import { jsonError } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Resume in-progress Live — same session ID, fresh WHIP creds, clock unchanged. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSessionUser();
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { takeover?: boolean };
    const result = await resumeLiveSession({
      user,
      sessionId: id,
      takeover: Boolean(body.takeover),
    });
    return Response.json({ ok: true, ...result }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const code = (err as { code?: string }).code;
    const message = err instanceof Error ? err.message : "Could not resume Live";
    if (status === 401) return jsonError("Sign in required", 401, { code });
    if (status >= 400 && status < 500) return jsonError(message, status, { code });
    console.error("[live:resume]", err);
    return jsonError(message, 500, { code });
  }
}
