import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { createReviewSchema, jsonError } from "@/lib/validation";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function mapReview(r: {
  id: string;
  revieweeId: string;
  reviewerId: string | null;
  authorName: string;
  rating: number;
  text: string;
  transactionId: string | null;
  createdAt: Date;
  reviewer?: {
    id: string;
    name: string;
    username: string | null;
    slug: string | null;
    photo: string;
  } | null;
}) {
  return {
    id: r.id,
    revieweeId: r.revieweeId,
    reviewerId: r.reviewerId,
    authorName: r.authorName,
    rating: r.rating,
    text: r.text,
    transactionId: r.transactionId,
    createdAt: r.createdAt.toISOString(),
    reviewer: r.reviewer
      ? {
          id: r.reviewer.id,
          name: r.reviewer.name,
          username: r.reviewer.username,
          slug: r.reviewer.slug,
          photo: r.reviewer.photo,
        }
      : null,
  };
}

/** Public reviews for a user (reviewee), paginated. */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const userId = sp.get("userId");
    if (!userId) return jsonError("userId required", 400);

    const cursor = sp.get("cursor") || undefined;
    const limit = Math.min(
      Math.max(Number(sp.get("limit") || DEFAULT_LIMIT) || DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );

    const rows = await prisma.review.findMany({
      where: { revieweeId: userId },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        reviewer: {
          select: {
            id: true,
            name: true,
            username: true,
            slug: true,
            photo: true,
          },
        },
      },
    });

    const slice = rows.slice(0, limit);
    const avg = await prisma.review.aggregate({
      where: { revieweeId: userId },
      _avg: { rating: true },
      _count: { rating: true },
    });

    return Response.json({
      reviews: slice.map(mapReview),
      nextCursor: rows.length > limit ? slice[slice.length - 1]?.id ?? null : null,
      summary: {
        count: avg._count.rating,
        averageRating: avg._avg.rating,
      },
    });
  } catch (err) {
    console.error("[reviews:list]", err);
    return jsonError("Failed to load reviews", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (!user.emailVerified) return jsonError("Verify email first", 403);

    const body = await req.json();
    const parsed = createReviewSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }

    const transaction = await prisma.transaction.findUnique({
      where: { id: parsed.data.transactionId },
    });
    if (!transaction) return jsonError("Transaction not found", 404);
    if (transaction.status !== "COMPLETED") {
      return jsonError("Reviews are only allowed on completed transactions", 400);
    }
    if (transaction.buyerId !== user.id && transaction.sellerId !== user.id) {
      return jsonError("Only transaction parties can leave a review", 403);
    }

    const revieweeId =
      transaction.buyerId === user.id
        ? transaction.sellerId
        : transaction.buyerId;

    if (revieweeId === user.id) {
      return jsonError("You cannot review yourself", 400);
    }

    const existing = await prisma.review.findFirst({
      where: {
        transactionId: transaction.id,
        reviewerId: user.id,
      },
    });
    if (existing) {
      return jsonError("You have already reviewed this transaction", 409);
    }

    const review = await prisma.review.create({
      data: {
        revieweeId,
        reviewerId: user.id,
        authorName: user.name,
        rating: parsed.data.rating,
        text: parsed.data.text,
        transactionId: transaction.id,
      },
      include: {
        reviewer: {
          select: {
            id: true,
            name: true,
            username: true,
            slug: true,
            photo: true,
          },
        },
      },
    });

    return Response.json({ ok: true, review: mapReview(review) }, { status: 201 });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message =
      err instanceof Error ? err.message : "Failed to create review";
    if (status === 401) return jsonError("Sign in required", 401);
    // Unique constraint race
    if (
      typeof err === "object" &&
      err &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return jsonError("You have already reviewed this transaction", 409);
    }
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[reviews:create]", err);
    return jsonError(message, status);
  }
}
