import { prisma } from "@/lib/db";
import { adminDisputeThreadPairKey, adminSupportThreadPairKey } from "@/lib/conversation-pair";
import { isAllowedAttachmentUrl, participantUserSelect } from "@/lib/messaging";
import { createNotification } from "@/lib/notifications";

export const ADMIN_DISPUTE_CONTEXT = "admin_dispute";

export type AdminDisputePartyRole = "BUYER" | "SELLER";

function throwHttp(message: string, status: number, code?: string): never {
  throw Object.assign(new Error(message), { status, code });
}

async function insertDisputeContextMarker(opts: {
  conversationId: string;
  disputeCaseId: string;
  protectedTxnId: string;
  paymentTicketId: string | null;
  title: string;
}) {
  const body = [
    "Dispute context",
    `dispute ${opts.disputeCaseId}`,
    `txn ${opts.protectedTxnId}`,
    opts.paymentTicketId ? `ticket ${opts.paymentTicketId}` : null,
    opts.title ? `"${opts.title}"` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  await prisma.message.create({
    data: {
      conversationId: opts.conversationId,
      senderId: null,
      body,
      messageType: "SYSTEM",
      systemEventType: "DISPUTE_CONTEXT",
    },
  });
}

/**
 * Get or create a private Admin↔party thread for a dispute.
 * Reuses the same support thread across disputes for that party.
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

  const pairKey = adminSupportThreadPairKey(opts.adminUserId, partyId);
  const legacyPairKey = adminDisputeThreadPairKey(dispute.id, opts.role);

  const existing =
    (await prisma.conversation.findUnique({
      where: { pairKey },
      include: {
        participants: { include: { user: { select: participantUserSelect } } },
      },
    })) ||
    (await prisma.conversation.findUnique({
      where: { pairKey: legacyPairKey },
      include: {
        participants: { include: { user: { select: participantUserSelect } } },
      },
    }));

  if (existing) {
    if (existing.pairKey !== pairKey) {
      await prisma.conversation.update({
        where: { id: existing.id },
        data: { pairKey },
      });
    }
    const markerExists = await prisma.message.findFirst({
      where: {
        conversationId: existing.id,
        systemEventType: "DISPUTE_CONTEXT",
        body: { contains: opts.disputeCaseId },
      },
      select: { id: true },
    });
    if (!markerExists) {
      await insertDisputeContextMarker({
        conversationId: existing.id,
        disputeCaseId: dispute.id,
        protectedTxnId: dispute.protectedTxn.id,
        paymentTicketId: dispute.protectedTxn.paymentTicket?.id ?? null,
        title: dispute.protectedTxn.title,
      });
    }
    return {
      conversation: existing,
      created: false,
      partyId,
      dispute,
    };
  }

  const subject =
    opts.role === "BUYER"
      ? "Source Bridge — private message with buyer"
      : "Source Bridge — private message with sourcer";
  const now = new Date();
  try {
    const conversation = await prisma.$transaction(async (tx) => {
      const conv = await tx.conversation.create({
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
      await tx.message.create({
        data: {
          conversationId: conv.id,
          senderId: null,
          body: [
            "Dispute context",
            `dispute ${dispute.id}`,
            `txn ${dispute.protectedTxn.id}`,
            dispute.protectedTxn.paymentTicket?.id
              ? `ticket ${dispute.protectedTxn.paymentTicket.id}`
              : null,
            dispute.protectedTxn.title ? `"${dispute.protectedTxn.title}"` : null,
          ]
            .filter(Boolean)
            .join(" · "),
          messageType: "SYSTEM",
          systemEventType: "DISPUTE_CONTEXT",
        },
      });
      return conv;
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
  const dispute = await prisma.disputeCase.findUnique({
    where: { id: disputeCaseId },
    select: {
      id: true,
      protectedTxn: {
        select: { buyerId: true, sellerId: true },
      },
    },
  });
  if (!dispute) return [];

  const threads = await prisma.conversation.findMany({
    where: {
      contextType: ADMIN_DISPUTE_CONTEXT,
      OR: [
        { disputeCaseId },
        {
          adminPartyRole: "BUYER",
          participants: { some: { userId: dispute.protectedTxn.buyerId } },
        },
        {
          adminPartyRole: "SELLER",
          participants: { some: { userId: dispute.protectedTxn.sellerId } },
        },
      ],
    },
    include: {
      participants: { include: { user: { select: participantUserSelect } } },
      messages: {
        orderBy: { createdAt: "asc" },
        take: 80,
        include: {
          sender: { select: participantUserSelect },
          attachments: true,
        },
      },
    },
  });

  const byRole = new Map<string, (typeof threads)[number]>();
  for (const t of threads) {
    if (t.adminPartyRole) byRole.set(t.adminPartyRole, t);
  }
  return [...byRole.values()];
}

export async function sendAdminDisputeMessage(opts: {
  adminUserId: string;
  conversationId: string;
  body: string;
  attachmentUrls?: string[];
}) {
  const body = opts.body.trim();
  const urls = (opts.attachmentUrls || []).map((u) => u.trim()).filter(Boolean);
  if (!body && urls.length === 0) throwHttp("Message is required", 400);
  if (body.length > 4000) throwHttp("Message is too long", 400);
  for (const url of urls) {
    if (!isAllowedAttachmentUrl(url, opts.adminUserId)) {
      throwHttp("Invalid attachment URL for this account", 400);
    }
  }

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
        body: body || (urls.length ? "Sent a photo" : ""),
        messageType: "USER",
        attachments: urls.length
          ? {
              create: urls.slice(0, 3).map((url) => ({
                url,
                pathname: "",
                mimeType: "image/*",
                sizeBytes: 0,
              })),
            }
          : undefined,
      },
      include: {
        sender: { select: participantUserSelect },
        attachments: true,
      },
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
