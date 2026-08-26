import { NextRequest } from "next/server";
import { getExploreFeedVersion } from "@/lib/explore-feed-activity";
import { buildMergedLiveFeed } from "@/lib/members-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = {
  "Cache-Control": "private, no-store, max-age=0, must-revalidate",
} as const;

export async function GET(req: NextRequest) {
  const poll = req.nextUrl.searchParams.get("poll") === "1";
  const sinceVersion = req.nextUrl.searchParams.get("sinceVersion");

  if (poll) {
    const feedVersion = await getExploreFeedVersion();
    if (sinceVersion && sinceVersion === feedVersion) {
      return Response.json(
        { unchanged: true, feedVersion },
        { headers: NO_STORE },
      );
    }
    const limitRaw = Number(req.nextUrl.searchParams.get("limit") || "8");
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 100)
      : 8;
    const items = await buildMergedLiveFeed(limit);
    return Response.json(
      { unchanged: false, feedVersion, items },
      { headers: NO_STORE },
    );
  }

  const limitRaw = Number(req.nextUrl.searchParams.get("limit") || "40");
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), 100)
    : 40;
  const [items, feedVersion] = await Promise.all([
    buildMergedLiveFeed(limit),
    getExploreFeedVersion(),
  ]);
  return Response.json(
    { items, feedVersion },
    { headers: NO_STORE },
  );
}
