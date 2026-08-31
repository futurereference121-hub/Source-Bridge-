import { requireSessionUser } from "@/lib/auth";
import { issueLiveWatchGrant } from "@/lib/live/watch";
import { getLiveSessionById, toLiveSessionPublic } from "@/lib/live/sessions";
import { jsonError } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Authenticated watch grant — Cloudflare playback URLs only, no video proxy. */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSessionUser();
    const { id } = await ctx.params;
    const grant = await issueLiveWatchGrant({ user, sessionId: id });
    const full = await getLiveSessionById(id);
    return Response.json({
      ok: true,
      session: full ? toLiveSessionPublic(full) : null,
      ...grant,
    }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const code = (err as { code?: string }).code;
    const message = err instanceof Error ? err.message : "Cannot watch Live";
    if (status === 401) return jsonError("Sign in required", 401, { code });
    if (status >= 400 && status < 500) return jsonError(message, status, { code });
    console.error("[live:watch]", err);
    return jsonError(message, 500, { code });
  }
}
