import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { assertDailyLimit, checkDailyLimit, recordDailyAction } from "@/lib/rate-limit";
import { jsonError } from "@/lib/validation";
import { notifyFollowersOfPost } from "@/lib/notifications";
import { revalidatePath } from "next/cache";
import { mapOpportunityPublic } from "@/lib/opportunities/map";
import { structuredOpportunityCreateSchema } from "@/lib/opportunities/validation";
import {
  buildStructuredOpportunityData,
  findByClientRequestId,
  findRecentDuplicateOpportunity,
} from "@/lib/opportunities/create";
import { isCreatableOpportunityKind } from "@/lib/opportunities/kinds";

export async function GET() {
  try {
    const user = await requireSessionUser();
    const rows = await prisma.opportunity.findMany({
      where: { userId: user.id },
      orderBy: { postedAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            name: true,
            slug: true,
            photo: true,
          },
        },
      },
    });
    const limit = await checkDailyLimit(user.id, "opportunity");
    return Response.json({
      opportunities: rows.map((r) => mapOpportunityPublic(r)),
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

    if (!body || typeof body !== "object" || !("kind" in body)) {
      return jsonError(
        "Choose Buyer Request, Sourcing Offer, or Travel Opportunity",
        400,
      );
    }
    if (!isCreatableOpportunityKind(body.kind)) {
      return jsonError(
        "Choose Buyer Request, Sourcing Offer, or Travel Opportunity",
        400,
      );
    }

    const parsed = structuredOpportunityCreateSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        parsed.error.issues[0]?.message || "Invalid opportunity",
        400,
      );
    }

    if (parsed.data.clientRequestId) {
      const existing = await findByClientRequestId(
        user.id,
        parsed.data.clientRequestId,
      );
      if (existing) {
        const limit = await checkDailyLimit(user.id, "opportunity");
        return Response.json({
          ok: true,
          opportunity: mapOpportunityPublic(existing),
          limit,
          idempotent: true,
        });
      }
    }

    const data = buildStructuredOpportunityData(user.id, parsed.data);
    const title = String(data.title || "");
    const city = String(data.city || "");
    const country = String(data.country || "");
    const dup = await findRecentDuplicateOpportunity({
      userId: user.id,
      kind: parsed.data.kind,
      title,
      city,
      country,
    });
    if (dup) {
      return jsonError(
        "A similar opportunity was posted recently. Edit that one or wait before posting again.",
        409,
      );
    }

    await assertDailyLimit(user.id, "opportunity");
    const row = await prisma.opportunity.create({ data });
    const limit = await recordDailyAction(user.id, "opportunity");
    const opportunity = mapOpportunityPublic(row);

    // Respond immediately — follower notify + path revalidation are not on the
    // critical path for creator close / profile return.
    void (async () => {
      try {
        if (user.slug) {
          await notifyFollowersOfPost({
            authorId: user.id,
            authorName: user.username ? `@${user.username}` : user.name,
            kind: "OPPORTUNITY",
            text: row.description || row.title,
            href: `/opportunities?id=${row.id}`,
          });
        }
      } catch (err) {
        console.error("[opportunity:notify]", err);
      }
      try {
        revalidatePath("/activity");
        revalidatePath("/explore");
        revalidatePath("/opportunities");
        revalidatePath("/api/feed");
      } catch (err) {
        console.error("[opportunity:revalidate]", err);
      }
    })();

    return Response.json({
      ok: true,
      opportunity,
      limit,
    });
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
