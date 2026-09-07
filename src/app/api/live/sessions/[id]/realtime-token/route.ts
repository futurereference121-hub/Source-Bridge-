import { requireSessionUser } from "@/lib/auth";
import { issueLiveRealtimeToken } from "@/lib/live/realtime";
import { LIVE_ENGAGEMENT_UNAVAILABLE_MESSAGE } from "@/lib/live/realtime/constants";
import { jsonError } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-issued Ably TokenRequest for one LIVE session.
 * Never returns ABLY_API_KEY. Capabilities are channel-scoped.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSessionUser();
    const { id } = await ctx.params;
    const grant = await issueLiveRealtimeToken({ user, sessionId: id });
    return Response.json(grant, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const code = (err as { code?: string }).code;
    const message =
      err instanceof Error ? err.message : LIVE_ENGAGEMENT_UNAVAILABLE_MESSAGE;
    if (status === 401) return jsonError("Sign in required", 401, { code });
    if (status >= 400 && status < 500) {
      return jsonError(message, status, { code });
    }
    if (code === "ABLY_UNAVAILABLE") {
      return jsonError(LIVE_ENGAGEMENT_UNAVAILABLE_MESSAGE, 503, { code });
    }
    console.error("[live:realtime-token]", code || "error");
    return jsonError(LIVE_ENGAGEMENT_UNAVAILABLE_MESSAGE, 503, {
      code: code || "ABLY_UNAVAILABLE",
    });
  }
}
