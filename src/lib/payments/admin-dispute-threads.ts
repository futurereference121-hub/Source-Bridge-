import { prisma } from "@/lib/db";
import { adminDisputeThreadPairKey } from "@/lib/conversation-pair";
import { participantUserSelect } from "@/lib/messaging";
import { createNotification } from "@/lib/notifications";

export const ADMIN_DISPUTE_CONTEXT = "admin_dispute";

export type AdminDisputePartyRole = "BUYER" | "SELLER";

function throwHttp(message: string, status: number, code?: string): never {
  throw Object.assign(new Error(message), { status, code });
}

/**
 * Get or create a private Admin↔party thread for a dispute.
 * Never reuses the Buyer↔Sourcer conversation.
 */
export async function getOrCreateAdminDisputeThread(opts: {
  adminUserId: string;
  disputeCaseId: string;
  role: AdminDisputePartyRole;
}) {
  const dispute = await prisma.disputeCase.findUnique({
    where: { id: opts.disputeCaseId },
    include: {
      protectedTxn: {
        select: {
          id: true,
          buyerId: true,
          sellerId: true,
          conversationId: true,
          paymentTicket: { select: { id: true } },
          title: true,
        },
      },
    },
  });
  if (!dispute) throwHttp("Dispute not found", 404);
  const partyId =
    opts.role === "BUYER"
      ? dispute.protectedTxn.buyerId
      : dispute.protectedTxn.sellerId;
  if (!partyId) throwHttp("Party not found", 404);
  if (partyId === opts.adminUserId) {
    throwHttp("Admin cannot message themselves as a dispute party", 400);
  }

  const pairKey = adminDisputeThreadPairKey(dispute.id, opts.role);
  const existing = await prisma.conversation.findUnique({
    where: { pairKey },
    include: {
      participants: { include: { user: { select: participantUserSelect } } },
    },
  });
  if (existing) {
    return {
      conversation: existing,
      created: false,
      partyId,
      dispute,
    };
  }

  const byCase = await prisma.conversation.findFirst({
    where: { disputeCaseId: dispute.id, adminPartyRole: opts.role },
    include: {
      participants: { include: { user: { select: participantUserSelect } } },
    },
  });
  if (byCase) {
    return { conversation: byCase, created: false, partyId, dispute };
  }

  const subject =
    opts.role === "BUYER"
      ? "Source Bridge — private message with buyer"
      : "Source Bridge — private message with sourcer";
  const now = new Date();
  try {
    const conversation = await prisma.conversation.create({
      data: {
        pairKey,
        subject,
        contextType: ADMIN_DISPUTE_CONTEXT,
        disputeCaseId: dispute.id,
        paymentTicketId: dispute.protectedTxn.paymentTicket?.id ?? null,
        adminPartyRole: opts.role,
        lastMessageAt: now,
        participants: {
          create: [
            { userId: opts.adminUserId, lastReadAt: now },
            { userId: partyId },
          ],
        },
      },
      include: {
        participants: { include: { user: { select: participantUserSelect } } },
      },
    });
    return { conversation, created: true, partyId, dispute };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "P2002") throw err;
    const raced = await prisma.conversation.findUnique({
      where: { pairKey },
      include: {
        participants: { include: { user: { select: participantUserSelect } } },
      },
    });
    if (!raced) throw err;
    return { conversation: raced, created: false, partyId, dispute };
  }
}

export async function listAdminDisputeThreads(disputeCaseId: string) {
  return prisma.conversation.findMany({
    where: { disputeCaseId, contextType: ADMIN_DISPUTE_CONTEXT },
    include: {
      participants: { include: { user: { select: participantUserSelect } } },
      messages: {
        orderBy: { createdAt: "asc" },
        take: 50,
        include: {
          sender: { select: participantUserSelect },
        },
      },
    },
  });
}

export async function sendAdminDisputeMessage(opts: {
  adminUserId: string;
  conversationId: string;
  body: string;
}) {
  const body = opts.body.trim();
  if (!body) throwHttp("Message is required", 400);
  if (body.length > 4000) throwHttp("Message is too long", 400);

  const conversation = await prisma.conversation.findUnique({
    where: { id: opts.conversationId },
    include: {
      participants: true,
    },
  });
  if (!conversation || conversation.contextType !== ADMIN_DISPUTE_CONTEXT) {
    throwHttp("Admin dispute thread not found", 404);
  }
  const isParticipant = conversation.participants.some(
    (p) => p.userId === opts.adminUserId && !p.leftAt,
  );
  if (!isParticipant) throwHttp("Not a participant", 403);

  const partyId = conversation.participants.find(
    (p) => p.userId !== opts.adminUserId,
  )?.userId;
  if (!partyId) throwHttp("Party not found", 404);

  const now = new Date();
  const message = await prisma.$transaction(async (tx) => {
    const msg = await tx.message.create({
      data: {
        conversationId: conversation.id,
        senderId: opts.adminUserId,
        body,
        messageType: "USER",
      },
      include: { sender: { select: participantUserSelect } },
    });
    await tx.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: now },
    });
    return msg;
  });

  await createNotification({
    userId: partyId,
    type: "PAYMENT_DISPUTE",
    title: "Message from Source Bridge",
    body: "You have a private message about a payment issue.",
    href: `/inbox/${conversation.id}`,
    actorId: opts.adminUserId,
    actorName: "Source Bridge",
    dedupeKey: `admin-dispute-msg:${message.id}`,
  });

  return { message, conversationId: conversation.id, partyId };
}
