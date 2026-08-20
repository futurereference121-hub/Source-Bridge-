import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * Monotonic conversation activity sequence — bumps on every meaningful mutation
 * (messages, tickets, protected txns, disputes). Poll clients pass `sinceVersion`
 * to avoid false "unchanged" when timestamps collide or aggregate lag.
 */
export async function bumpConversationActivity(
  conversationId: string,
  client: DbClient = prisma,
  opts?: { touchLastMessage?: boolean },
): Promise<number> {
  const row = await client.conversation.update({
    where: { id: conversationId },
    data: {
      activityVersion: { increment: 1 },
      updatedAt: new Date(),
      ...(opts?.touchLastMessage ? { lastMessageAt: new Date() } : {}),
    },
    select: { activityVersion: true },
  });
  return row.activityVersion;
}

export async function getConversationActivityVersion(
  conversationId: string,
  client: DbClient = prisma,
): Promise<number> {
  const row = await client.conversation.findUnique({
    where: { id: conversationId },
    select: { activityVersion: true },
  });
  return row?.activityVersion ?? 0;
}

/** Legacy timestamp aggregate — kept for backward-compatible poll clients. */
export async function conversationActivityAt(
  conversationId: string,
  client: DbClient = prisma,
): Promise<string> {
  const [conv, ticketMax, protectedTxnMax, disputeMax] = await Promise.all([
    client.conversation.findUnique({
      where: { id: conversationId },
      select: { lastMessageAt: true, updatedAt: true },
    }),
    client.paymentTicket.aggregate({
      where: { conversationId },
      _max: { updatedAt: true, lastMeaningfulActivityAt: true },
    }),
    client.protectedTransaction.aggregate({
      where: { conversationId },
      _max: { updatedAt: true },
    }),
    client.disputeCase.aggregate({
      where: {
        protectedTxn: { conversationId },
      },
      _max: { updatedAt: true },
    }),
  ]);
  const latest = Math.max(
    conv?.lastMessageAt?.getTime() ?? 0,
    conv?.updatedAt?.getTime() ?? 0,
    ticketMax._max.updatedAt?.getTime() ?? 0,
    ticketMax._max.lastMeaningfulActivityAt?.getTime() ?? 0,
    protectedTxnMax._max.updatedAt?.getTime() ?? 0,
    disputeMax._max.updatedAt?.getTime() ?? 0,
  );
  return new Date(latest || Date.now()).toISOString();
}
