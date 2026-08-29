import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { bumpConversationActivity } from "@/lib/conversation-activity";

type DbClient = Prisma.TransactionClient | typeof prisma;

export type ProtectedTxnMoneyEvent = "PROCUREMENT_RELEASED" | "FINAL_RELEASED";

type TxnSlice = {
  id: string;
  conversationId?: string | null;
  buyerId: string;
  sellerId: string;
  title?: string | null;
  origin?: string | null;
};

/**
 * Bump ticket clocks + conversation activityVersion after authoritative txn mutation.
 * Call only after domain + Stripe transfer success (or idempotent reconcile).
 */
export async function syncProtectedTxnParticipantActivity(opts: {
  protectedTxnId: string;
  conversationId?: string | null;
  client?: DbClient;
  touchLastMessage?: boolean;
}): Promise<{ activityVersion: number; linkedTicketId: string | null }> {
  const client = opts.client ?? prisma;

  await client.paymentTicket.updateMany({
    where: { protectedTransactionId: opts.protectedTxnId },
    data: { lastMeaningfulActivityAt: new Date() },
  });

  const linked = await client.paymentTicket.findFirst({
    where: { protectedTransactionId: opts.protectedTxnId },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
  });

  let activityVersion = 0;
  if (opts.conversationId) {
    activityVersion = await bumpConversationActivity(opts.conversationId, client, {
      touchLastMessage: opts.touchLastMessage ?? true,
    });
  }

  return { activityVersion, linkedTicketId: linked?.id ?? null };
}

/** Activity sync + idempotent counterparty notification for release events. */
export async function afterProtectedTxnMoneyEvent(opts: {
  txn: TxnSlice;
  event: ProtectedTxnMoneyEvent;
  actorUserId?: string | null;
}): Promise<{ activityVersion: number; linkedTicketId: string | null }> {
  const sync = await syncProtectedTxnParticipantActivity({
    protectedTxnId: opts.txn.id,
    conversationId: opts.txn.conversationId,
    touchLastMessage: true,
  });

  try {
    const {
      notifyProcurementReleased,
      notifyFinalReleased,
    } = await import("@/lib/payment-notifications");

    if (opts.event === "PROCUREMENT_RELEASED") {
      await notifyProcurementReleased({
        protectedTxnId: opts.txn.id,
        conversationId: opts.txn.conversationId || "",
        sellerId: opts.txn.sellerId,
        buyerId: opts.txn.buyerId,
        title: opts.txn.title || "Protected Payment",
        ticketId: sync.linkedTicketId,
        origin: opts.txn.origin,
        actorUserId: opts.actorUserId ?? opts.txn.buyerId,
      });
    } else {
      await notifyFinalReleased({
        protectedTxnId: opts.txn.id,
        conversationId: opts.txn.conversationId || "",
        sellerId: opts.txn.sellerId,
        buyerId: opts.txn.buyerId,
        title: opts.txn.title || "Protected Payment",
        ticketId: sync.linkedTicketId,
        origin: opts.txn.origin,
        actorUserId: opts.actorUserId ?? opts.txn.buyerId,
      });
    }
  } catch (err) {
    console.error("[payments:after-txn-money-event:notify]", err);
  }

  return sync;
}
