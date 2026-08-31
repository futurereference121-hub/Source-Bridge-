import { expireLiveIfNeeded, getLiveSessionById, toLiveSessionPublic } from "@/lib/live/sessions";
import { jsonError } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** Public Live metadata — no video URLs. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;
    const row = await expireLiveIfNeeded(id);
    if (!row) return jsonError("Live not found", 404);
    const full = await getLiveSessionById(id);
    if (!full) return jsonError("Live not found", 404);
    return Response.json(
      { session: toLiveSessionPublic(full) },
      { headers: { "Cache-Control": "public, max-age=3" } },
    );
  } catch (err) {
    console.error("[live:get]", err);
    return jsonError("Could not load Live", 500);
  }
}
