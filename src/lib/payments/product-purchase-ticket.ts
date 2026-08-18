import { prisma } from "@/lib/db";
import { getOrCreateConversationPair } from "@/lib/messaging";
import { isDirectPaymentOption } from "@/lib/payments/payment-option";
import { recordAuditEvent } from "@/lib/payments/ledger";

/**
 * Dedicated Product Purchase Ticket for protected listing checkout.
 * Distinct from sourcing Payment Tickets: fulfilment/proof only, no negotiation.
 * Historical Direct purchases are left untouched.
 */
export async function ensureProductPurchaseTicket(protectedTxnId: string): Promise<{
  ticketId: string | null;
  conversationId: string | null;
  created: boolean;
}> {
  const txn = await prisma.protectedTransaction.findUnique({
    where: { id: protectedTxnId },
    include: { paymentTicket: { select: { id: true, conversationId: true } } },
  });
  if (!txn) return { ticketId: null, conversationId: null, created: false };
  if (txn.origin !== "PRODUCT_CHECKOUT") {
    return {
      ticketId: txn.paymentTicket?.id ?? null,
      conversationId: txn.conversationId,
      created: false,
    };
  }
  if (isDirectPaymentOption(txn.paymentOption)) {
    return {
      ticketId: null,
      conversationId: txn.conversationId,
      created: false,
    };
  }
  if (!txn.fundedAt) {
    return {
      ticketId: txn.paymentTicket?.id ?? null,
      conversationId: txn.conversationId,
      created: false,
    };
  }

  if (txn.paymentTicket) {
    if (!txn.conversationId && txn.paymentTicket.conversationId) {
      await prisma.protectedTransaction.update({
        where: { id: txn.id },
        data: { conversationId: txn.paymentTicket.conversationId },
      });
    }
    await ensureProductPurchaseTicketMessage(
      txn.paymentTicket.conversationId,
      txn.paymentTicket.id,
      txn.buyerId,
    );
    return {
      ticketId: txn.paymentTicket.id,
      conversationId: txn.paymentTicket.conversationId,
      created: false,
    };
  }

  const { conversation } = await getOrCreateConversationPair(
    txn.buyerId,
    txn.sellerId,
    {
      contextType: "direct",
      listingId: txn.listingId,
      subject: txn.title || "Product purchase",
    },
  );

  const now = new Date();
  try {
    const ticket = await prisma.$transaction(async (tx) => {
      const existing = await tx.paymentTicket.findUnique({
        where: { protectedTransactionId: txn.id },
      });
      if (existing) return existing;

      const created = await tx.paymentTicket.create({
        data: {
          conversationId: conversation.id,
          createdById: txn.buyerId,
          buyerId: txn.buyerId,
          sellerId: txn.sellerId,
          listingId: txn.listingId,
          status: "FUNDED",
          revision: 1,
          termsHash: txn.termsHash,
          title: txn.title || "Product purchase",
          currency: txn.currency,
          itemCostMinor: txn.itemCostMinor,
          shippingMinor: txn.shippingMinor,
          sellerServiceFeeMinor: txn.sellerServiceFeeMinor,
          protectionFeeMinor: txn.protectionFeeMinor,
          totalChargeMinor: txn.totalChargeMinor,
          paymentOption: txn.paymentOption,
          procurementAdvanceAgreed: false,
          procurementAdvanceMinor: 0,
          notes: "Product Purchase Ticket — fulfilment and shipping proof.",
          stripeMode: txn.stripeMode,
          lastMeaningfulActivityAt: now,
          buyerApprovedRevision: 1,
          sellerApprovedRevision: 1,
          buyerApprovedAt: now,
          sellerApprovedAt: now,
          protectedTransactionId: txn.id,
        },
      });
      await tx.message.create({
        data: {
          conversationId: conversation.id,
          senderId: txn.buyerId,
          body: "Product Purchase Ticket — Protected by Source Bridge.",
          messageType: "PAYMENT_TICKET",
          systemEventType: "PAYMENT_TICKET_PROPOSED",
          paymentTicketId: created.id,
          replyAllowed: true,
          createdAt: txn.fundedAt || now,
        },
      });
      await tx.protectedTransaction.update({
        where: { id: txn.id },
        data: { conversationId: conversation.id },
      });
      await tx.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now, updatedAt: now },
      });
      return created;
    });

    await recordAuditEvent({
      protectedTxnId: txn.id,
      actorUserId: txn.buyerId,
      action: "PRODUCT_PURCHASE_TICKET_CREATED",
      meta: { ticketId: ticket.id, conversationId: conversation.id },
    });

    return {
      ticketId: ticket.id,
      conversationId: conversation.id,
      created: true,
    };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "P2002") throw err;
    const raced = await prisma.paymentTicket.findUnique({
      where: { protectedTransactionId: txn.id },
    });
    return {
      ticketId: raced?.id ?? null,
      conversationId: raced?.conversationId ?? conversation.id,
      created: false,
    };
  }
}

async function ensureProductPurchaseTicketMessage(
  conversationId: string,
  ticketId: string,
  senderId: string,
) {
  const existing = await prisma.message.findFirst({
    where: { conversationId, paymentTicketId: ticketId },
    select: { id: true },
  });
  if (existing) return;
  await prisma.message.create({
    data: {
      conversationId,
      senderId,
      body: "Product Purchase Ticket — Protected by Source Bridge.",
      messageType: "PAYMENT_TICKET",
      systemEventType: "PAYMENT_TICKET_PROPOSED",
      paymentTicketId: ticketId,
      replyAllowed: true,
    },
  });
}

/**
 * Catch-up: funded protected listing purchases between this pair that never
 * received a Product Purchase Ticket (historical TEST checkouts).
 */
export async function backfillProductPurchaseTicketsForConversation(
  conversationId: string,
): Promise<number> {
  const conv = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      contextType: true,
      participants: { select: { userId: true, leftAt: true } },
    },
  });
  if (!conv || conv.contextType === "admin_dispute") return 0;
  const ids = conv.participants
    .filter((p) => !p.leftAt)
    .map((p) => p.userId);
  if (ids.length !== 2) return 0;
  const [a, b] = ids;
  const txns = await prisma.protectedTransaction.findMany({
    where: {
      origin: "PRODUCT_CHECKOUT",
      fundedAt: { not: null },
      paymentTicket: null,
      OR: [
        { conversationId },
        { AND: [{ buyerId: a }, { sellerId: b }] },
        { AND: [{ buyerId: b }, { sellerId: a }] },
      ],
    },
    select: { id: true, paymentOption: true },
    take: 8,
  });
  let n = 0;
  for (const t of txns) {
    if (isDirectPaymentOption(t.paymentOption)) continue;
    const result = await ensureProductPurchaseTicket(t.id);
    if (result.created) n += 1;
  }
  return n;
}

