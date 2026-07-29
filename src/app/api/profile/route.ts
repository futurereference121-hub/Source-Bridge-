import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireSessionUser, toPublicAccount } from "@/lib/auth";
import { jsonError, publicDisplayMessageSchema } from "@/lib/validation";
import { z } from "zod";
import { getMemberByIdAsync, toPublicMemberJson } from "@/lib/members-service";
import { pathnameBelongsToUser } from "@/lib/storage";
import { revalidatePublicMemberSurfaces } from "@/lib/revalidate-public";

function isAllowedProfileImageUrl(url: string, userId: string): boolean {
  if (!url || !url.trim()) return true;
  const value = url.trim();
  try {
    if (value.startsWith("https://")) {
      const parsed = new URL(value);
      const hostOk =
        parsed.hostname.endsWith(".public.blob.vercel-storage.com") ||
        parsed.hostname.endsWith(".blob.vercel-storage.com");
      if (!hostOk) return false;
      return pathnameBelongsToUser(parsed.pathname, userId);
    }
  } catch {
    return false;
  }
  const cleaned = value.replace(/^\//, "");
  if (cleaned.startsWith("uploads/")) {
    return pathnameBelongsToUser(cleaned.slice("uploads/".length), userId);
  }
  return false;
}

const profileUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  bio: z.string().trim().max(600).optional(),
  photo: z.string().optional(),
  cover: z.string().optional(),
  city: z.string().trim().max(80).optional(),
  country: z.string().trim().max(80).optional(),
  publicDisplayMessage: publicDisplayMessageSchema.optional(),
  specialties: z.array(z.string()).max(20).optional(),
});

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");
  if (slug) {
    const { getMemberBySlugAsync } = await import("@/lib/members-service");
    const member = await getMemberBySlugAsync(slug);
    if (!member) return jsonError("Not found", 404);
    return Response.json({ member: toPublicMemberJson(member) });
  }

  const user = await getSessionUser();
  if (!user) return jsonError("Sign in required", 401);

  const member = await getMemberByIdAsync(user.id);
  const followerCount = await prisma.follow.count({
    where: { followingId: user.id, followingIsSeed: false },
  });
  const followingCount = await prisma.follow.count({
    where: { followerId: user.id },
  });

  return Response.json({
    account: toPublicAccount(user),
    member: member ? toPublicMemberJson(member) : null,
    counts: { followers: followerCount, following: followingCount },
  });
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body = await req.json();
    const parsed = profileUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }
    const data = parsed.data;
    if (
      (data.photo !== undefined &&
        !isAllowedProfileImageUrl(data.photo, user.id)) ||
      (data.cover !== undefined &&
        !isAllowedProfileImageUrl(data.cover, user.id))
    ) {
      return jsonError("Invalid image URL for this account", 400);
    }
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.bio !== undefined ? { bio: data.bio } : {}),
        ...(data.photo !== undefined ? { photo: data.photo } : {}),
        ...(data.cover !== undefined ? { cover: data.cover } : {}),
        ...(data.city !== undefined ? { city: data.city } : {}),
        ...(data.country !== undefined ? { country: data.country } : {}),
        ...(data.publicDisplayMessage !== undefined
          ? { publicDisplayMessage: data.publicDisplayMessage }
          : {}),
        ...(data.specialties !== undefined
          ? { specialties: JSON.stringify(data.specialties) }
          : {}),
      },
    });
    revalidatePublicMemberSurfaces({
      slug: updated.slug,
      username: updated.username,
    });
    return Response.json({ ok: true, account: toPublicAccount(updated) });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[profile]", err instanceof Error ? err.message : err);
    return jsonError("Profile couldn't be saved. Please try again.", 500);
  }
}
