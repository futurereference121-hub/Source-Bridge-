import { NextRequest } from "next/server";
import { getAllMembers, toPublicMemberJson } from "@/lib/members-service";
import { searchMembers } from "@/lib/search-members";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { products } from "@/data/products";
import { dbStockToListing } from "@/lib/member-map";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  const all = await getAllMembers();
  const dbListings = await prisma.stockListing.findMany();
  const listings = [...products, ...dbListings.map(dbStockToListing)];
  const results = searchMembers(q, all, listings);

  const viewer = await getSessionUser();
  let followingIds: string[] = [];
  if (viewer) {
    const follows = await prisma.follow.findMany({
      where: { followerId: viewer.id },
      select: { followingId: true },
    });
    followingIds = follows.map((f) => f.followingId);
  }

  return Response.json({
    members: results.map(toPublicMemberJson),
    followingIds,
  });
}
