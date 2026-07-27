import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { assertDailyLimit, checkDailyLimit, recordDailyAction } from "@/lib/rate-limit";
import { jsonError, opportunitySchema } from "@/lib/validation";
import { listCategoryNames } from "@/lib/categories-db";

function mapOpp(o: {
  id: string;
  title: string;
  description: string;
  city: string;
  country: string;
  category: string;
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

    const allowed = await listCategoryNames();
    if (
      !allowed.some(
        (c) => c.toLowerCase() === parsed.data.category.toLowerCase(),
      )
    ) {
      return jsonError("Select a category from the list", 400);
    }

    await assertDailyLimit(user.id, "opportunity");
    const row = await prisma.opportunity.create({
      data: {
        userId: user.id,
        title: parsed.data.title,
        description: parsed.data.description,
        city: parsed.data.city,
        country: parsed.data.country,
        category: parsed.data.category,
        expiresAt: parsed.data.expiresAt
          ? new Date(parsed.data.expiresAt)
          : null,
      },
    });
    const limit = await recordDailyAction(user.id, "opportunity");

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
