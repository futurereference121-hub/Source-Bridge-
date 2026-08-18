import { NextRequest } from "next/server";
import {
  listDirectoryMembersPage,
  toPublicMemberJson,
  DIRECTORY_PAGE_SIZE_MOBILE,
} from "@/lib/members-service";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  const page = Number(req.nextUrl.searchParams.get("page") || "1") || 1;
  const requested = Number(req.nextUrl.searchParams.get("limit") || "0") || 0;
  const limit =
    requested > 0
      ? requested
      : Number(req.nextUrl.searchParams.get("mobile") || "0") === 1
        ? DIRECTORY_PAGE_SIZE_MOBILE
        : 36;

  const result = await listDirectoryMembersPage({ q, page, limit });

  const viewer = await getSessionUser();
  let followingIds: string[] = [];
  if (viewer) {
    const follows = await prisma.follow.findMany({
      where: { followerId: viewer.id },
      select: { followingId: true },
    });
    followingIds = follows.map((f) => f.followingId);
  }

  return Response.json(
    {
      members: result.members.map(toPublicMemberJson),
      followingIds,
      page: result.page,
      limit: result.limit,
      total: result.total,
      hasMore: result.hasMore,
    },
    {
      headers: {
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
      },
    },
  );
}
