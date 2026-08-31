import { requireSessionUser } from "@/lib/auth";
import { getLivePresence } from "@/lib/live/discovery";
import { jsonError } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    await requireSessionUser().catch(() => null);
    const { searchParams } = new URL(req.url);
    const ids = (searchParams.get("userIds") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 100);
    const presence = await getLivePresence(ids);
    return Response.json(
      { ok: true, presence },
      {
        headers: {
          "Cache-Control": "public, max-age=5, stale-while-revalidate=15",
        },
      },
    );
  } catch (err) {
    console.error("[live:presence]", err);
    return jsonError("Could not load Live presence", 500);
  }
}
