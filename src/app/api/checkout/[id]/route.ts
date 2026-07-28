import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { jsonError, patchCheckoutSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

const partySelect = {
  id: true,
  name: true,
  username: true,
  slug: true,
  photo: true,
} as const;

function mapCheckoutTransaction(t: {
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
  paymentMethod: string;
  paymentStatus: string;
  selectedSize: string;
  cryptoNetwork: string;
  cryptoWalletAddress: string;
  cryptoTransactionHash: string;
  buyerConfirmed: boolean;
  sellerConfirmed: boolean;
  escrowStatus: string;
  paymentMethodId: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  buyer?: {
    id: string;
    name: string;
    username: string | null;
    slug: string | null;
    photo: string;
  };
  seller?: {
    id: string;
    name: string;
    username: string | null;
    slug: string | null;
    photo: string;
  };
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
    paymentMethod: t.paymentMethod,
    paymentStatus: t.paymentStatus,
    selectedSize: t.selectedSize,
    cryptoNetwork: t.cryptoNetwork,
    cryptoWalletAddress: t.cryptoWalletAddress,
    cryptoTransactionHash: t.cryptoTransactionHash,
    buyerConfirmed: t.buyerConfirmed,
    sellerConfirmed: t.sellerConfirmed,
    escrowStatus: t.escrowStatus,
    paymentMethodId: t.paymentMethodId,
    completedAt: t.completedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    buyer: t.buyer,
    seller: t.seller,
  };
}

/**
 * Buyer may submit cryptoTransactionHash + buyerConfirmed (does NOT mark paid).
 * Seller may set sellerConfirmed; when both confirmed, paymentStatus stays
 * awaiting_confirmation (or pending) and a seller_acknowledged note is appended.
 * Never sets paymentStatus to "paid" or status to COMPLETED.
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireSessionUser();
    const { id } = await ctx.params;
    const existing = await prisma.transaction.findUnique({ where: { id } });
    if (!existing) return jsonError("Transaction not found", 404);

    const isBuyer = existing.buyerId === user.id;
    const isSeller = existing.sellerId === user.id;
    if (!isBuyer && !isSeller) {
      return jsonError("Not a party to this transaction", 403);
    }

    const body = await req.json();
    const parsed = patchCheckoutSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }
    const data = parsed.data;

    if (isBuyer && !isSeller) {
      if (data.sellerConfirmed !== undefined) {
        return jsonError("Only the seller can set sellerConfirmed", 403);
      }
    }
    if (isSeller && !isBuyer) {
      if (data.cryptoTransactionHash !== undefined || data.buyerConfirmed !== undefined) {
        return jsonError("Only the buyer can submit payment confirmation", 403);
      }
    }

    const nextHash =
      data.cryptoTransactionHash !== undefined
        ? data.cryptoTransactionHash
        : existing.cryptoTransactionHash;
    const nextBuyerConfirmed =
      data.buyerConfirmed !== undefined
        ? data.buyerConfirmed
        : data.cryptoTransactionHash
          ? true
          : existing.buyerConfirmed;
    const nextSellerConfirmed =
      data.sellerConfirmed !== undefined
        ? data.sellerConfirmed
        : existing.sellerConfirmed;

    let notes = existing.notes;
    let paymentStatus = existing.paymentStatus;

    // Buyer hash submission keeps awaiting_confirmation — never mark paid.
    if (isBuyer && (data.cryptoTransactionHash || data.buyerConfirmed)) {
      paymentStatus = "awaiting_confirmation";
      if (data.cryptoTransactionHash) {
        notes = appendNote(
          notes,
          `Buyer submitted crypto tx hash ${data.cryptoTransactionHash}.`,
        );
      }
    }

    // Seller acknowledgement: note only; still not paid without Stripe/admin.
    if (isSeller && data.sellerConfirmed === true) {
      notes = appendNote(notes, "seller_acknowledged: seller confirmed receipt/review.");
      // Prefer keeping awaiting_confirmation; both confirmed → still not paid.
      paymentStatus = "awaiting_confirmation";
    }

    // Explicit: never promote to paid or COMPLETED from this endpoint.
    if (paymentStatus === "paid" || existing.status === "COMPLETED") {
      // leave as-is if somehow already set by admin elsewhere
    }

    const row = await prisma.transaction.update({
      where: { id },
      data: {
        cryptoTransactionHash: nextHash,
        buyerConfirmed: nextBuyerConfirmed,
        sellerConfirmed: nextSellerConfirmed,
        paymentStatus,
        notes,
        // Do NOT set status COMPLETED or paymentStatus paid.
      },
      include: {
        buyer: { select: partySelect },
        seller: { select: partySelect },
      },
    });

    return Response.json({
      ok: true,
      transaction: mapCheckoutTransaction(row),
      notice:
        "Payment is not marked paid. Buyer hash keeps awaiting_confirmation; seller confirmation adds a seller_acknowledged note only. Stripe/admin required to mark paid.",
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[checkout:patch]", err);
    return jsonError("Update failed", 500);
  }
}

function appendNote(existing: string, line: string): string {
  const trimmed = (existing || "").trim();
  if (!trimmed) return line;
  if (trimmed.includes(line)) return trimmed;
  return `${trimmed}\n${line}`;
}
