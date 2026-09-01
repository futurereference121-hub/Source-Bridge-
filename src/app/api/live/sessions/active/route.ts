import { requireSessionUser } from "@/lib/auth";
import { getBroadcasterActiveSession, toLiveSessionPublic } from "@/lib/live/sessions";
import { jsonError } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Broadcaster's in-progress PREPARING/LIVE session, if any. */
export async function GET() {
  try {
    const user = await requireSessionUser();
    const row = await getBroadcasterActiveSession(user.id);
    return Response.json(
      { session: row ? toLiveSessionPublic(row) : null },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[live:active]", err);
    return jsonError("Could not load Live session", 500);
  }
}
