import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { bumpConversationActivity } from "@/lib/conversation-activity";

type DbClient = Prisma.TransactionClient | typeof prisma;

/**
 * Clear per-user inbox hide so the conversation resurfaces for all
 * participants who had hidden/deleted it from their inbox.
 * Does not touch leftAt, Message rows, or Payment Tickets.
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
  await clearConversationHidden(conversationId, client);
  return version;
}

function throwHttp(message: string, status: number, code?: string): never {
  const err = new Error(message) as Error & { status: number; code?: string };
  err.status = status;
  if (code) err.code = code;
  throw err;
}

/**
 * Soft-hide a conversation for the caller only (Hide chat / Delete chat).
 * Shared messages and financial tickets are never destroyed.
 */
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
 * Prisma filter: exclude messages this user has Delete-for-me'd.
 */
export function messageVisibleToUserWhere(userId: string): Prisma.MessageWhereInput {
  return {
    hides: { none: { userId } },
  };
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
