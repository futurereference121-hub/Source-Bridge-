import { requireSessionUser } from "@/lib/auth";
import { getBroadcasterPublishCredentials } from "@/lib/live/sessions";
import { jsonError } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Broadcaster-only WHIP credentials. Never returned to viewers. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSessionUser();
    const { id } = await ctx.params;
    const publish = await getBroadcasterPublishCredentials({
      user,
      sessionId: id,
    });
    return Response.json(
      { publish },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : "Forbidden";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[live:publish]", err);
    return jsonError(message, 500);
  }
}
