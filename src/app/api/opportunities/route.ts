import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { assertDailyLimit, checkDailyLimit, recordDailyAction } from "@/lib/rate-limit";
import { jsonError, opportunitySchema } from "@/lib/validation";
import { notifyFollowersOfPost } from "@/lib/notifications";
import { revalidatePath } from "next/cache";

function autoTitle(description: string, city: string, country: string): string {
  const clipped = description.trim().replace(/\s+/g, " ").slice(0, 80);
  if (clipped.length >= 12) {
    return clipped.length < description.trim().length ? `${clipped}…` : clipped;
  }
  const place = [city, country].filter(Boolean).join(", ");
  return place ? `Opportunity in ${place}` : "Opportunity";
}

function mapOpp(o: {
  id: string;
  title: string;
  description: string;
  city: string;
  country: string;
  category: string;
  startsAt: Date | null;
  postedAt: Date;
  expiresAt: Date | null;
  closedAt: Date | null;
}) {
  const expired = o.expiresAt ? o.expiresAt.getTime() <= Date.now() : false;
  const active = !o.closedAt && !expired;
  return {
    id: o.id,
    title: o.title,
    summary: o.title,
    description: o.description,
    city: o.city,
    country: o.country,
    category: o.category,
    categories: [o.category],
    startsAt: o.startsAt?.toISOString() ?? null,
    postedAt: o.postedAt.toISOString(),
    expiresAt: o.expiresAt?.toISOString() ?? null,
    closedAt: o.closedAt?.toISOString() ?? null,
    active,
  };
}

export async function GET() {
  try {
    const user = await requireSessionUser();
    const rows = await prisma.opportunity.findMany({
      where: { userId: user.id },
      orderBy: { postedAt: "desc" },
    });
    const limit = await checkDailyLimit(user.id, "opportunity");
    return Response.json({
      opportunities: rows.map(mapOpp),
      limit,
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    return jsonError("Failed to load opportunities", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (!user.emailVerified) return jsonError("Verify email first", 403);
    if (!user.onboardingComplete) {
      return jsonError(
        "Complete your profile before submitting an opportunity",
        403,
      );
    }

    const body = await req.json();
    const parsed = opportunitySchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid opportunity", 400);
    }

    const title =
      parsed.data.title?.trim() ||
      autoTitle(parsed.data.description, parsed.data.city, parsed.data.country);
    const category = parsed.data.category?.trim() || "General";

    await assertDailyLimit(user.id, "opportunity");
    const row = await prisma.opportunity.create({
      data: {
        userId: user.id,
        title,
        description: parsed.data.description,
        city: parsed.data.city,
        country: parsed.data.country,
        category,
        startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : null,
        expiresAt: parsed.data.expiresAt
          ? new Date(parsed.data.expiresAt)
          : null,
      },
    });
    const limit = await recordDailyAction(user.id, "opportunity");

    if (user.slug) {
      await notifyFollowersOfPost({
        authorId: user.id,
        authorName: user.username ? `@${user.username}` : user.name,
        kind: "OPPORTUNITY",
        text: row.description || row.title,
        href: `/members/${user.slug}`,
      });
    }

    // Revalidate Live Activity / Explore so the new opportunity appears immediately.
    revalidatePath("/activity");
    revalidatePath("/explore");
    revalidatePath("/api/feed");

    return Response.json({ ok: true, opportunity: mapOpp(row), limit });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message =
      err instanceof Error ? err.message : "Failed to submit opportunity";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status === 429) return jsonError(message, 429);
    console.error("[opportunity]", err);
    return jsonError(message, status);
  }
}
