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
 * Bump ticket clocks + conversation activityVersion after an authoritative
 * ticket mutation. Call after the mutation transaction has committed.
 * Authorization and provider-success callers are separate.
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

/**
 * Buyer authorization has committed. Refresh the sourcer ticket immediately
 * and notify; do not wait for funding, cron, or provider payout success.
 */
export async function afterBuyerReleaseAuthorized(opts: {
  txn: TxnSlice;
  kind: "PROCUREMENT" | "FINAL";
  amountMinor: number;
  currency?: string | null;
  actorUserId?: string | null;
}): Promise<{ activityVersion: number; linkedTicketId: string | null }> {
  const stored = await prisma.protectedTransaction.findUnique({
    where: { id: opts.txn.id },
    select: {
      id: true,
      conversationId: true,
      buyerId: true,
      sellerId: true,
      title: true,
      origin: true,
      currency: true,
    },
  });
  const txn = {
    ...opts.txn,
    ...(stored || {}),
  };
  const sync = await syncProtectedTxnParticipantActivity({
    protectedTxnId: txn.id,
    conversationId: txn.conversationId,
    touchLastMessage: true,
  });
  try {
    const { notifyReleaseAuthorized } = await import("@/lib/payment-notifications");
    await notifyReleaseAuthorized({
      protectedTxnId: txn.id,
      conversationId: txn.conversationId || "",
      sellerId: txn.sellerId,
      buyerId: txn.buyerId,
      title: txn.title || "Protected Payment",
      ticketId: sync.linkedTicketId,
      origin: txn.origin,
      actorUserId: opts.actorUserId ?? txn.buyerId,
      kind: opts.kind,
      amountMinor: opts.amountMinor,
      currency: opts.currency || "GBP",
    });
  } catch (err) {
    console.error("[payments:after-buyer-release-authorized:notify]", err);
  }
  return sync;
}

/** Activity sync + idempotent payout-sent notification after provider success. */
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
