import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { publicMemberWhere } from "@/lib/discoverability";
import {
  assertSafeTrustPassportDto,
  resolveTrustPassportDetail,
} from "@/lib/trust-passport";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteParams = { params: Promise<{ slug: string }> };

/**
 * Authenticated Trust Passport detail.
 * Logged-out requests receive 401 — never leak the protected payload.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const session = await getSessionUser();
  if (!session) {
    return NextResponse.json(
      { error: "Sign in required", code: "AUTH_REQUIRED" },
      { status: 401 },
    );
  }

  const { slug } = await params;
  const handle = (slug || "").trim().replace(/^@/, "");
  if (!handle) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: [{ slug: handle }, { username: handle }],
      ...publicMemberWhere,
    },
    select: {
      id: true,
      photo: true,
      name: true,
      username: true,
      slug: true,
    },
  });

  // Owners viewing their own non-public profile (e.g. temporarily undiscoverable)
  // may still open their passport via self lookup.
  let target = user;
  if (!target && session.username && session.username.toLowerCase() === handle.toLowerCase()) {
    target = await prisma.user.findFirst({
      where: {
        id: session.id,
        deletedAt: null,
      },
      select: {
        id: true,
        photo: true,
        name: true,
        username: true,
        slug: true,
      },
    });
  }

  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isOwner = session.id === target.id;
  const detail = await resolveTrustPassportDetail({
    userId: target.id,
    viewerId: session.id,
    isOwner,
  });

  if (!detail) {
    return NextResponse.json(
      { error: "Trust Passport unavailable", code: "UNAVAILABLE" },
      { status: 404 },
    );
  }

  const payload = {
    ...detail,
    profile: {
      photo: target.photo,
      displayName: target.name,
      username: target.username || "",
      slug: target.slug || handle,
    },
  };

  try {
    assertSafeTrustPassportDto(payload as unknown as Record<string, unknown>);
  } catch (err) {
    console.error("[trust-passport] unsafe DTO blocked", err);
    return NextResponse.json({ error: "Unavailable" }, { status: 500 });
  }

  // No long-lived cache — revoked verification / payout disablement must apply promptly.
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0, must-revalidate",
    },
  });
}
