import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { jsonError, patchTransactionSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

const partySelect = {
  id: true,
  name: true,
  username: true,
  slug: true,
  photo: true,
} as const;

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

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireSessionUser();
    const { id } = await params;

    const existing = await prisma.transaction.findUnique({ where: { id } });
    if (!existing) return jsonError("Transaction not found", 404);
    if (existing.buyerId !== user.id && existing.sellerId !== user.id) {
      return jsonError("Only the buyer or seller can update this transaction", 403);
    }

    const body = await req.json();
    const parsed = patchTransactionSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }

    const now = new Date();
    const becomingCompleted = parsed.data.status === "COMPLETED";
    const leavingCompleted =
      existing.status === "COMPLETED" && parsed.data.status !== "COMPLETED";

    const row = await prisma.transaction.update({
      where: { id },
      data: {
        status: parsed.data.status,
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
        ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
        ...(parsed.data.amount !== undefined ? { amount: parsed.data.amount } : {}),
        ...(becomingCompleted
          ? { completedAt: existing.completedAt ?? now }
          : leavingCompleted
            ? { completedAt: null }
            : {}),
      },
      include: {
        buyer: { select: partySelect },
        seller: { select: partySelect },
      },
    });

    return Response.json({ ok: true, transaction: mapTransaction(row) });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message =
      err instanceof Error ? err.message : "Failed to update transaction";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[transactions:patch]", err);
    return jsonError(message, status);
  }
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireSessionUser();
    const { id } = await params;

    const row = await prisma.transaction.findUnique({
      where: { id },
      include: {
        buyer: { select: partySelect },
        seller: { select: partySelect },
      },
    });
    if (!row) return jsonError("Transaction not found", 404);
    if (row.buyerId !== user.id && row.sellerId !== user.id) {
      return jsonError("Only the buyer or seller can view this transaction", 403);
    }

    return Response.json({ transaction: mapTransaction(row) });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message =
      err instanceof Error ? err.message : "Failed to load transaction";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[transactions:get]", err);
    return jsonError(message, status);
  }
}
