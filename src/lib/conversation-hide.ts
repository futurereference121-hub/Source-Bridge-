import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { bumpConversationActivity } from "@/lib/conversation-activity";

type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * Clear per-user inbox hide so the conversation resurfaces.
 * Never clears deletedBeforeAt — Delete keeps a history cutoff.
 */
export async function clearConversationHidden(
  conversationId: string,
  client: DbClient = prisma,
): Promise<number> {
  const result = await client.conversationParticipant.updateMany({
    where: { conversationId, hiddenAt: { not: null } },
    data: { hiddenAt: null },
  });
  return result.count;
}

/**
 * Meaningful activity: bump version and resurface any per-user inbox hides.
 */
export async function bumpAndResurfaceConversation(
  conversationId: string,
  client: DbClient = prisma,
  opts?: { touchLastMessage?: boolean },
): Promise<number> {
  const version = await bumpConversationActivity(conversationId, client, opts);
  // bumpConversationActivity already clears hiddenAt; keep helper for callers.
  return version;
}

function throwHttp(message: string, status: number, code?: string): never {
  const err = new Error(message) as Error & { status: number; code?: string };
  err.status = status;
  if (code) err.code = code;
  throw err;
}

/** Soft-hide from inbox only — full history remains on resurface. */
export async function hideConversationForUser(
  conversationId: string,
  userId: string,
): Promise<void> {
  await prisma.conversationParticipant.update({
    where: {
      conversationId_userId: { conversationId, userId },
    },
    data: { hiddenAt: new Date() },
  });
}

/**
 * Delete from inbox for this user only. Sets a cutoff so resurfaced chats
 * show only messages after this moment. Does not destroy shared Message rows.
 */
export async function deleteConversationForUser(
  conversationId: string,
  userId: string,
): Promise<void> {
  const now = new Date();
  await prisma.conversationParticipant.update({
    where: {
      conversationId_userId: { conversationId, userId },
    },
    data: {
      hiddenAt: now,
      deletedBeforeAt: now,
    },
  });
}

/**
 * Prisma filter: exclude Delete-for-me hides and pre-delete-cutoff messages.
 */
export function messageVisibleToUserWhere(
  userId: string,
  deletedBeforeAt?: Date | null,
): Prisma.MessageWhereInput {
  return {
    hides: { none: { userId } },
    ...(deletedBeforeAt
      ? { createdAt: { gt: deletedBeforeAt } }
      : {}),
  };
}

export async function getParticipantDeleteCutoff(
  conversationId: string,
  userId: string,
  client: DbClient = prisma,
): Promise<Date | null> {
  const row = await client.conversationParticipant.findUnique({
    where: {
      conversationId_userId: { conversationId, userId },
    },
    select: { deletedBeforeAt: true },
  });
  return row?.deletedBeforeAt ?? null;
}

/**
 * Per-user Delete for me. Refuses payment-ticket / completed financial cards.
 * Does not destroy shared Message rows or attachments for other participants.
 */
export async function hideMessageForUser(opts: {
  conversationId: string;
  messageId: string;
  userId: string;
}): Promise<{ ok: true }> {
  const message = await prisma.message.findFirst({
    where: {
      id: opts.messageId,
      conversationId: opts.conversationId,
    },
    select: {
      id: true,
      paymentTicketId: true,
      messageType: true,
    },
  });
  if (!message) {
    throwHttp("Message not found", 404);
  }

  // Financial ticket cards / receipts stay available via ticket history.
  if (message.paymentTicketId) {
    throwHttp(
      "Completed financial tickets and Payment Ticket cards cannot be deleted for you",
      409,
      "FINANCIAL_RECEIPT_PROTECTED",
    );
  }
  if (message.messageType === "PAYMENT_TICKET") {
    throwHttp(
      "Payment Ticket cards cannot be deleted for you",
      409,
      "FINANCIAL_RECEIPT_PROTECTED",
    );
  }

  await prisma.messageHide.upsert({
    where: {
      messageId_userId: {
        messageId: message.id,
        userId: opts.userId,
      },
    },
    create: {
      messageId: message.id,
      userId: opts.userId,
    },
    update: { hiddenAt: new Date() },
  });

  return { ok: true };
}
