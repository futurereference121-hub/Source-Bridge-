import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { createTransactionSchema, jsonError } from "@/lib/validation";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function mapTransaction(t: {
  id: string;
  status: string;
  buyerId: string;
  sellerId: string;
  conversationId: string | null;
  sourcingRequestId: string | null;
  listingId: string | null;
  opportunityId: string | null;
  title: string;
  notes: string;
  amount: number | null;
  currency: string;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  buyer?: { id: string; name: string; username: string | null; slug: string | null; photo: string };
  seller?: { id: string; name: string; username: string | null; slug: string | null; photo: string };
}) {
  return {
    id: t.id,
    status: t.status,
    buyerId: t.buyerId,
    sellerId: t.sellerId,
    conversationId: t.conversationId,
    sourcingRequestId: t.sourcingRequestId,
    listingId: t.listingId,
    opportunityId: t.opportunityId,
    title: t.title,
    notes: t.notes,
    amount: t.amount,
    currency: t.currency,
    completedAt: t.completedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    buyer: t.buyer,
    seller: t.seller,
  };
}

const partySelect = {
  id: true,
  name: true,
  username: true,
  slug: true,
  photo: true,
} as const;

export async function GET(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const sp = req.nextUrl.searchParams;
    const cursor = sp.get("cursor") || undefined;
    const role = sp.get("role"); // buyer | seller | all
    const status = sp.get("status") || undefined;
    const limit = Math.min(
      Math.max(Number(sp.get("limit") || DEFAULT_LIMIT) || DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );

    const roleFilter =
      role === "buyer"
        ? { buyerId: user.id }
        : role === "seller"
          ? { sellerId: user.id }
          : { OR: [{ buyerId: user.id }, { sellerId: user.id }] };

    const rows = await prisma.transaction.findMany({
      where: {
        ...roleFilter,
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        buyer: { select: partySelect },
        seller: { select: partySelect },
      },
    });

    const slice = rows.slice(0, limit);
    return Response.json({
      transactions: slice.map(mapTransaction),
      nextCursor: rows.length > limit ? slice[slice.length - 1]?.id ?? null : null,
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[transactions:list]", err);
    return jsonError("Failed to load transactions", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (!user.emailVerified) return jsonError("Verify email first", 403);
    if (!user.onboardingComplete) {
      return jsonError("Complete your profile first", 403);
    }

    const body = await req.json();
    const parsed = createTransactionSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }

    const buyerId = parsed.data.buyerId || user.id;
    const { sellerId } = parsed.data;

    if (buyerId !== user.id && sellerId !== user.id) {
      return jsonError("You must be the buyer or seller", 403);
    }
    if (buyerId === sellerId) {
      return jsonError("Buyer and seller must be different users", 400);
    }

    const seller = await prisma.user.findUnique({
      where: { id: sellerId },
      select: { id: true },
    });
    if (!seller) return jsonError("Seller not found", 404);

    if (parsed.data.buyerId && parsed.data.buyerId !== user.id) {
      const buyer = await prisma.user.findUnique({
        where: { id: buyerId },
        select: { id: true },
      });
      if (!buyer) return jsonError("Buyer not found", 404);
    }

    if (parsed.data.conversationId) {
      const conversation = await prisma.conversation.findUnique({
        where: { id: parsed.data.conversationId },
        select: { id: true },
      });
      if (!conversation) return jsonError("Conversation not found", 404);
    }

    const row = await prisma.transaction.create({
      data: {
        status: "REQUESTED",
        buyerId,
        sellerId,
        conversationId: parsed.data.conversationId ?? null,
        sourcingRequestId: parsed.data.sourcingRequestId ?? null,
        listingId: parsed.data.listingId ?? null,
        opportunityId: parsed.data.opportunityId ?? null,
        title: parsed.data.title || "",
        notes: parsed.data.notes || "",
        amount: parsed.data.amount ?? null,
        currency: parsed.data.currency || "USD",
      },
      include: {
        buyer: { select: partySelect },
        seller: { select: partySelect },
      },
    });

    return Response.json({ ok: true, transaction: mapTransaction(row) }, { status: 201 });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message =
      err instanceof Error ? err.message : "Failed to create transaction";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[transactions:create]", err);
    return jsonError(message, status);
  }
}
