import { requireSessionUser } from "@/lib/auth";
import {
  createLiveComment,
  listRecentLiveComments,
} from "@/lib/live/realtime";
import {
  LIVE_COMMENT_REJECTED_MESSAGE,
  LIVE_ENGAGEMENT_UNAVAILABLE_MESSAGE,
} from "@/lib/live/realtime/constants";
import { jsonError } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Limited recent canonical comments for late joiners (DB — not Ably History). */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSessionUser();
    const { id } = await ctx.params;
    const result = await listRecentLiveComments({ user, sessionId: id });
    return Response.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const code = (err as { code?: string }).code;
    const message =
      err instanceof Error ? err.message : "Could not load comments";
    if (status === 401) return jsonError("Sign in required", 401, { code });
    if (status >= 400 && status < 500) {
      return jsonError(message, status, { code });
    }
    console.error("[live:comments:get]", code || "error");
    return jsonError("Could not load comments", 500, { code });
  }
}

/**
 * Authenticated public Live comment write path:
 * validate → persist → server publishes to Ably → return canonical comment.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSessionUser();
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      body?: unknown;
      text?: unknown;
      clientMessageId?: unknown;
    };
    const comment = await createLiveComment({
      user,
      sessionId: id,
      body: body.body ?? body.text,
      clientMessageId: body.clientMessageId,
    });
    return Response.json(
      { ok: true, comment },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const code = (err as { code?: string }).code;
    const message =
      err instanceof Error ? err.message : LIVE_COMMENT_REJECTED_MESSAGE;
    if (status === 401) return jsonError("Sign in required", 401, { code });
    if (status >= 400 && status < 500) {
      return jsonError(message, status, { code });
    }
    console.error("[live:comments:post]", code || "error");
    return jsonError(LIVE_ENGAGEMENT_UNAVAILABLE_MESSAGE, 503, {
      code: code || "COMMENT_FAILED",
    });
  }
}
