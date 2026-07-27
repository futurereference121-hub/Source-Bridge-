import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/validation";
import { members as seedMembers } from "@/data/members";

function seedCard(id: string) {
  const m = seedMembers.find((x) => x.id === id);
  if (!m) return null;
  return {
    id: m.id,
    username: m.username,
    slug: m.slug,
    fullName: m.fullName,
    photo: m.photo,
    location: m.location.label,
    identityVerified: m.verification.identityVerified,
    isPrototype: true,
  };
}

async function userCard(id: string) {
  const u = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      username: true,
      slug: true,
      name: true,
      photo: true,
      city: true,
      country: true,
      identityVerified: true,
    },
  });
  if (!u || !u.username || !u.slug) return null;
  return {
    id: u.id,
    username: u.username,
    slug: u.slug,
    fullName: u.name,
    photo: u.photo || "/uploads/placeholders/avatar.svg",
    location:
      u.city && u.country ? `${u.city}, ${u.country}` : u.city || u.country || "",
    identityVerified: u.identityVerified,
    isPrototype: false,
  };
}

async function anyCard(id: string, isSeed: boolean) {
  if (isSeed) return seedCard(id);
  return (await userCard(id)) ?? seedCard(id);
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body = await req.json();
    const targetId = typeof body.memberId === "string" ? body.memberId : "";
    if (!targetId) return jsonError("memberId required", 400);
    if (targetId === user.id) return jsonError("You cannot follow yourself", 400);

    const targetUser = await prisma.user.findUnique({ where: { id: targetId } });
    const seed = seedMembers.find((m) => m.id === targetId);
    if (!targetUser && !seed) return jsonError("Member not found", 404);

    const followingIsSeed = !targetUser;
    const existing = await prisma.follow.findUnique({
      where: {
        followerId_followingId: {
          followerId: user.id,
          followingId: targetId,
        },
      },
    });

    if (existing) {
      await prisma.follow.delete({ where: { id: existing.id } });
      return Response.json({ ok: true, following: false, memberId: targetId });
    }

    await prisma.follow.create({
      data: { followerId: user.id, followingId: targetId, followingIsSeed },
    });
    return Response.json({ ok: true, following: true, memberId: targetId });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[follow]", err);
    return jsonError("Follow failed", 500);
  }
}

export async function GET(req: NextRequest) {
  try {
    const viewer = await getSessionUser();
    if (!viewer) {
      return jsonError("Sign in to view followers and following", 401);
    }

    const userId = req.nextUrl.searchParams.get("userId") || viewer.id;
    const kind = req.nextUrl.searchParams.get("kind") || "followers";

    if (kind === "following") {
      const rows = await prisma.follow.findMany({
        where: { followerId: userId },
        orderBy: { createdAt: "desc" },
      });
      const items = (
        await Promise.all(
          rows.map((r) => anyCard(r.followingId, r.followingIsSeed)),
        )
      ).filter(Boolean);
      return Response.json({ kind, items });
    }

    // Followers of a real user only (seed members have no DB followers from FKs)
    const rows = await prisma.follow.findMany({
      where: { followingId: userId, followingIsSeed: false },
      orderBy: { createdAt: "desc" },
    });
    const items = (
      await Promise.all(rows.map((r) => userCard(r.followerId)))
    ).filter(Boolean);
    return Response.json({ kind: "followers", items });
  } catch (err) {
    console.error("[follow:list]", err);
    return jsonError("Failed to load list", 500);
  }
}
