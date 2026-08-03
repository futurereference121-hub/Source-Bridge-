import { getSessionUser } from "@/lib/auth";
import { getStoryRingStates } from "@/lib/stories";
import { jsonError } from "@/lib/validation";

export const dynamic = "force-dynamic";

/** GET ?userIds=a,b,c — lightweight Story ring flags for cards/lists. */
export async function GET(req: Request) {
  try {
    const user = await getSessionUser();
    const { searchParams } = new URL(req.url);
    const raw = searchParams.get("userIds") || "";
    const userIds = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 100);

    if (!userIds.length) {
      return Response.json(
        { ok: true, rings: {} },
        { headers: { "Cache-Control": "private, max-age=5" } },
      );
    }

    const map = await getStoryRingStates(userIds, user?.id ?? null);
    const rings: Record<
      string,
      { hasActiveStory: boolean; hasUnseenStory: boolean }
    > = {};
    for (const [id, state] of map) {
      rings[id] = {
        hasActiveStory: state.hasActiveStory,
        hasUnseenStory: state.hasUnseenStory,
      };
    }
    return Response.json(
      { ok: true, rings },
      {
        headers: {
          // Short private cache cuts Explore N-storm DB load; client also TTL-batches.
          "Cache-Control": "private, max-age=5, stale-while-revalidate=15",
        },
      },
    );
  } catch (err) {
    console.error("[stories:rings]", err);
    return jsonError("Failed to load Story status", 500);
  }
}
