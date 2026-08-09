import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/validation";
import { prisma } from "@/lib/db";
import { createOrRevisePaymentTicket } from "@/lib/payments/tickets";
import { isProtectedPaymentsEnabled, isInstantPaymentsEnabled } from "@/lib/payments/flags";

export const runtime = "nodejs";

const createSchema = z.object({
  conversationId: z.string().trim().min(1),
  buyerId: z.string().trim().min(1).optional(),
  sellerId: z.string().trim().min(1).optional(),
  itemCostMinor: z.number().int().nonnegative(),
  shippingMinor: z.number().int().nonnegative().optional(),
  sellerServiceFeeMinor: z.number().int().nonnegative().optional(),
  title: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  paymentOption: z.enum(["PROTECTED", "INSTANT"]).optional(),
  procurementAdvanceAgreed: z.boolean().optional(),
  listingId: z.string().trim().nullable().optional(),
  currency: z.string().trim().length(3).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (!isProtectedPaymentsEnabled() && !isInstantPaymentsEnabled()) {
      return jsonError("Protected Payments are not enabled", 503);
    }

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }
    const data = parsed.data;

    const conversation = await prisma.conversation.findUnique({
      where: { id: data.conversationId },
      include: { participants: true },
    });
    if (!conversation) return jsonError("Conversation not found", 404);
    const parts = conversation.participants.filter((p) => !p.leftAt);
    if (!parts.some((p) => p.userId === user.id)) {
      return jsonError("Not a participant", 403);
    }
    const other = parts.find((p) => p.userId !== user.id);
    if (!other) return jsonError("Conversation needs two parties", 400);

    // Actor chooses role: default — creator is proposing as either party.
    // If buyerId/sellerId omitted, assume actor is buyer and other is seller
    // unless actor owns the listing.
    let buyerId = data.buyerId;
    let sellerId = data.sellerId;
    if (!buyerId || !sellerId) {
      if (conversation.listingId) {
        const listing = await prisma.stockListing.findUnique({
          where: { id: conversation.listingId },
          select: { userId: true },
        });
        if (listing) {
          sellerId = listing.userId;
          buyerId = listing.userId === user.id ? other.userId : user.id;
        }
      }
      if (!buyerId || !sellerId) {
        buyerId = user.id;
        sellerId = other.userId;
      }
    }

    const { ticket, message } = await createOrRevisePaymentTicket({
      conversationId: data.conversationId,
      actorId: user.id,
      buyerId,
      sellerId,
      amounts: {
        itemCostMinor: data.itemCostMinor,
        shippingMinor: data.shippingMinor,
        sellerServiceFeeMinor: data.sellerServiceFeeMinor,
        title: data.title,
        notes: data.notes,
        paymentOption: data.paymentOption,
        procurementAdvanceAgreed: data.procurementAdvanceAgreed,
        listingId: data.listingId,
        currency: data.currency,
      },
    });

    // Success path always includes ticket; message may be null (client can
    // synthesize a timeline row). No secrets / amounts in log lines.
    console.info("[payments:tickets:create] ok", {
      conversationId: data.conversationId,
      ticketId: ticket.id,
      messageId: message?.id ?? null,
    });

    return Response.json(
      { ok: true, ticket, message },
      {
        status: 201,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const code = (err as { code?: string }).code;
    const message = err instanceof Error ? err.message : "Failed";
    if (status === 401) return jsonError("Sign in required", 401);
    // Preserve client-facing errors: 403 allowlist, 400 validation, 409 races, 503 disabled.
    if ((status >= 400 && status < 500) || status === 503) {
      return jsonError(message, status, code ? { code } : undefined);
    }
    console.error("[payments:tickets:create]", err);
    return jsonError("Failed to create Payment Ticket", 500);
  }
}
