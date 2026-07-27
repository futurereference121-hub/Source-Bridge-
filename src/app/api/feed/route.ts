import { NextRequest } from "next/server";
import { buildMergedLiveFeed } from "@/lib/members-service";

export async function GET(req: NextRequest) {
  const limitRaw = Number(req.nextUrl.searchParams.get("limit") || "40");
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), 100)
    : 40;
  const items = await buildMergedLiveFeed(limit);
  return Response.json({ items });
}
