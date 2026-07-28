import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { createCheckoutSchema, jsonError } from "@/lib/validation";
import {
  mapConversation,
  participantUserSelect,
} from "@/lib/messaging";

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

function parseSizes(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
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
    const parsed = createCheckoutSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }

    const {
      listingId,
      paymentMethod,
      selectedSize,
      paymentMethodId,
      cryptoTransactionHash,
    } = parsed.data;

    const listing = await prisma.stockListing.findUnique({
      where: { id: listingId },
      include: {
        user: { select: partySelect },
      },
    });
    if (!listing) {
      // Seed/demo catalogue IDs are not in PostgreSQL — keep checkout UI
      // available without creating a live paid/pending marketplace txn.
      return Response.json({
        ok: true,
        demo: true,
        transaction: null,
        checkout: {
          mode: paymentMethod,
          stripeConfigured: false,
          message:
            "Demo listing checkout preview. Card marketplace payments (Stripe Connect) are not activated. Live pending transactions apply to real member listings only. No payment was taken.",
        },
      });
    }

    if (listing.userId === user.id) {
      return jsonError("You cannot buy your own listing", 400);
    }

    const saleStatus = listing.saleStatus || "AVAILABLE";
    if (saleStatus !== "AVAILABLE") {
      return jsonError(
        saleStatus === "SOLD"
          ? "This listing has been sold"
          : saleStatus === "RESERVED"
            ? "This listing is reserved"
            : "This listing is not available for purchase",
        400,
      );
    }

    const sizes = parseSizes(listing.sizes);
    const isClothing = (listing.productKind || "clothing") === "clothing";
    if (isClothing && sizes.length) {
      if (!selectedSize) {
        return jsonError("Select a size", 400);
      }
      if (!sizes.includes(selectedSize)) {
        return jsonError("Selected size is not available", 400);
      }
    }

    let cryptoNetwork = "";
    let cryptoWalletAddress = "";
    let resolvedPaymentMethodId: string | null = null;

    if (paymentMethod === "crypto") {
      if (!paymentMethodId) {
        return jsonError("Select a crypto payment method", 400);
      }
      const method = await prisma.sellerPaymentMethod.findUnique({
        where: { id: paymentMethodId },
      });
      if (
        !method ||
        method.userId !== listing.userId ||
        method.kind !== "crypto" ||
        !method.enabled
      ) {
        return jsonError("Payment method not available", 400);
      }
      cryptoNetwork = method.networkName;
      cryptoWalletAddress = method.address;
      resolvedPaymentMethodId = method.id;
    }

    const paymentStatus =
      paymentMethod === "crypto" ? "awaiting_confirmation" : "unpaid";

    let conversationId: string | null = null;
    let sourcingRequestId: string | null = null;
    let conversationPayload: ReturnType<typeof mapConversation> | null = null;

    if (paymentMethod === "contact") {
      const message = `Hi — I'm interested in purchasing “${listing.name}”.`;
      const existingOpen = await prisma.sourcingRequest.findFirst({
        where: {
          fromUserId: user.id,
          toUserId: listing.userId,
          status: "open",
          listingId: listing.id,
          opportunityId: null,
        },
        include: {
          conversation: {
            include: {
              participants: {
                include: { user: { select: participantUserSelect } },
              },
              messages: {
                orderBy: { createdAt: "desc" },
                take: 1,
                include: { attachments: true },
              },
            },
          },
        },
      });

      if (existingOpen?.conversation) {
        conversationId = existingOpen.conversation.id;
        sourcingRequestId = existingOpen.id;
        conversationPayload = mapConversation(
          existingOpen.conversation,
          user.id,
        );
      } else {
        const created = await prisma.$transaction(async (tx) => {
          const sr = await tx.sourcingRequest.create({
            data: {
              fromUserId: user.id,
              toUserId: listing.userId,
              listingId: listing.id,
              message,
              status: "open",
            },
          });
          const conversation = await tx.conversation.create({
            data: {
              subject: `Sourcing: ${listing.name}`,
              contextType: "listing",
              listingId: listing.id,
              sourcingRequestId: sr.id,
              lastMessageAt: new Date(),
              participants: {
                create: [
                  { userId: user.id },
                  { userId: listing.userId },
                ],
              },
              messages: {
                create: {
                  senderId: user.id,
                  body: message,
                },
              },
            },
            include: {
              participants: {
                include: { user: { select: participantUserSelect } },
              },
              messages: {
                orderBy: { createdAt: "desc" },
                take: 1,
                include: { attachments: true },
              },
            },
          });
          return { sr, conversation };
        });
        conversationId = created.conversation.id;
        sourcingRequestId = created.sr.id;
        conversationPayload = mapConversation(created.conversation, user.id);
      }
    }

    const row = await prisma.transaction.create({
      data: {
        status: "REQUESTED",
        buyerId: user.id,
        sellerId: listing.userId,
        listingId: listing.id,
        conversationId,
        sourcingRequestId,
        title: listing.name,
        amount: listing.price,
        currency: listing.currency || "USD",
        paymentMethod,
        paymentStatus,
        selectedSize: selectedSize || "",
        cryptoNetwork,
        cryptoWalletAddress,
        cryptoTransactionHash: cryptoTransactionHash || "",
        paymentMethodId: resolvedPaymentMethodId,
        buyerConfirmed: Boolean(cryptoTransactionHash),
        notes:
          paymentMethod === "card"
            ? "Card checkout pending — Stripe Connect not configured."
            : paymentMethod === "crypto"
              ? "Crypto payment awaiting confirmation. Do not mark paid until seller verifies."
              : "Contact seller checkout — arrange payment offline.",
      },
      include: {
        buyer: { select: partySelect },
        seller: { select: partySelect },
      },
    });

    const mode = paymentMethod;
    const message =
      paymentMethod === "card"
        ? "Card checkout is not yet activated. Stripe Connect marketplace payouts are not configured for Source Bridge. No payment will be taken. A pending unpaid transaction was created."
        : paymentMethod === "crypto"
          ? "Send crypto to the seller wallet shown, then submit your transaction hash. Payment stays awaiting confirmation until the seller acknowledges — Source Bridge does not auto-mark paid."
          : "A conversation with the seller was opened. Arrange payment and delivery directly — no payment is processed by Source Bridge.";

    return Response.json(
      {
        ok: true,
        transaction: mapCheckoutTransaction(row),
        checkout: {
          mode,
          stripeConfigured: false,
          message,
        },
        conversation: conversationPayload,
      },
      { status: 201 },
    );
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[checkout:create]", err);
    return jsonError("Checkout failed", 500);
  }
}
