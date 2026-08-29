import { prisma } from "@/lib/db";
import { bumpConversationActivity } from "@/lib/conversation-activity";
import { adminDisputeThreadPairKey, adminSupportThreadPairKey } from "@/lib/conversation-pair";
import { getParticipantDeleteCutoff } from "@/lib/conversation-hide";
import { isAllowedAttachmentUrl, markRead, participantUserSelect } from "@/lib/messaging";
import { createNotification } from "@/lib/notifications";
import {
  buildDisputeContextStructured,
  formatHumanDisputeContextBody,
} from "@/lib/payments/dispute-context-copy";

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
  status?: string | null;
  buyerUsername?: string | null;
  sellerUsername?: string | null;
  amountMinor?: number | null;
  currency?: string | null;
  createdAt: Date;
}) {
  const structured = buildDisputeContextStructured({
    title: opts.title,
    status: opts.status,
    buyerUsername: opts.buyerUsername,
    sellerUsername: opts.sellerUsername,
    amountMinor: opts.amountMinor,
    currency: opts.currency,
    createdAt: opts.createdAt,
    reviewHref: `/admin/reviews/${opts.disputeCaseId}`,
    disputeCaseId: opts.disputeCaseId,
    protectedTxnId: opts.protectedTxnId,
    paymentTicketId: opts.paymentTicketId,
  });
  // Concise human reference only — evidence stays in Admin → Reviews.
  const body = formatHumanDisputeContextBody(structured);
  await prisma.message.create({
    data: {
      conversationId: opts.conversationId,
      senderId: null,
      body,
      messageType: "SYSTEM",
      systemEventType: "DISPUTE_CONTEXT",
      paymentTicketId: opts.paymentTicketId,
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
          totalChargeMinor: true,
          currency: true,
          buyer: { select: { username: true } },
          seller: { select: { username: true } },
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

  const markerPayload = {
    disputeCaseId: dispute.id,
    protectedTxnId: dispute.protectedTxn.id,
    paymentTicketId: dispute.protectedTxn.paymentTicket?.id ?? null,
    title: dispute.protectedTxn.title,
    status: dispute.status,
    buyerUsername: dispute.protectedTxn.buyer?.username ?? null,
    sellerUsername: dispute.protectedTxn.seller?.username ?? null,
    amountMinor: dispute.protectedTxn.totalChargeMinor ?? null,
    currency: dispute.protectedTxn.currency ?? null,
    createdAt: dispute.createdAt,
  };

  if (existing) {
    if (
      existing.pairKey !== pairKey ||
      existing.disputeCaseId !== dispute.id
    ) {
      await prisma.conversation.update({
        where: { id: existing.id },
        data: {
          pairKey,
          disputeCaseId: dispute.id,
          paymentTicketId: dispute.protectedTxn.paymentTicket?.id ?? null,
          adminPartyRole: opts.role,
        },
      });
    }
    // Topic once per dispute, and again after a party's Delete cutoff so
    // resurfaced chats get a fresh context block without restoring old history.
    await ensureVisibleDisputeContextMarker({
      conversationId: existing.id,
      partyId,
      disputeCreatedAt: dispute.createdAt,
      markerPayload,
    });
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
      const structured = buildDisputeContextStructured({
        title: dispute.protectedTxn.title,
        status: dispute.status,
        buyerUsername: dispute.protectedTxn.buyer?.username ?? null,
        sellerUsername: dispute.protectedTxn.seller?.username ?? null,
        amountMinor: dispute.protectedTxn.totalChargeMinor ?? null,
        currency: dispute.protectedTxn.currency ?? null,
        createdAt: dispute.createdAt,
        reviewHref: `/admin/reviews/${dispute.id}`,
        disputeCaseId: dispute.id,
        protectedTxnId: dispute.protectedTxn.id,
        paymentTicketId: dispute.protectedTxn.paymentTicket?.id ?? null,
      });
      await tx.message.create({
        data: {
          conversationId: conv.id,
          senderId: null,
          body: formatHumanDisputeContextBody(structured),
          messageType: "SYSTEM",
          systemEventType: "DISPUTE_CONTEXT",
          paymentTicketId: dispute.protectedTxn.paymentTicket?.id ?? null,
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

/**
 * Insert DISPUTE_CONTEXT when missing for this dispute/ticket, or when the
 * party deleted the chat so prior markers sit behind deletedBeforeAt.
 * Idempotent per payment ticket (or dispute window when ticket is absent).
 */
async function ensureVisibleDisputeContextMarker(opts: {
  conversationId: string;
  partyId: string;
  disputeCreatedAt: Date;
  markerPayload: {
    disputeCaseId: string;
    protectedTxnId: string;
    paymentTicketId: string | null;
    title: string;
    status?: string | null;
    buyerUsername?: string | null;
    sellerUsername?: string | null;
    amountMinor?: number | null;
    currency?: string | null;
    createdAt: Date;
  };
}) {
  const cutoff = await getParticipantDeleteCutoff(
    opts.conversationId,
    opts.partyId,
  );
  const ticketId = opts.markerPayload.paymentTicketId;
  const afterDelete =
    cutoff && cutoff.getTime() > opts.disputeCreatedAt.getTime()
      ? cutoff
      : null;

  const markerExists = await prisma.message.findFirst({
    where: {
      conversationId: opts.conversationId,
      systemEventType: "DISPUTE_CONTEXT",
      ...(ticketId
        ? {
            paymentTicketId: ticketId,
            ...(afterDelete ? { createdAt: { gt: afterDelete } } : {}),
          }
        : {
            createdAt: afterDelete
              ? { gt: afterDelete }
              : { gte: opts.disputeCreatedAt },
          }),
    },
    select: { id: true },
  });
  if (markerExists) return false;
  await insertDisputeContextMarker({
    conversationId: opts.conversationId,
    ...opts.markerPayload,
  });
  return true;
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
      disputeCase: {
        include: {
          protectedTxn: {
            select: {
              id: true,
              title: true,
              totalChargeMinor: true,
              currency: true,
              buyer: { select: { username: true } },
              seller: { select: { username: true } },
              paymentTicket: { select: { id: true } },
            },
          },
        },
      },
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

  const dispute = conversation.disputeCase;
  if (dispute?.protectedTxn) {
    await ensureVisibleDisputeContextMarker({
      conversationId: conversation.id,
      partyId,
      disputeCreatedAt: dispute.createdAt,
      markerPayload: {
        disputeCaseId: dispute.id,
        protectedTxnId: dispute.protectedTxn.id,
        paymentTicketId: dispute.protectedTxn.paymentTicket?.id ?? null,
        title: dispute.protectedTxn.title,
        status: dispute.status,
        buyerUsername: dispute.protectedTxn.buyer?.username ?? null,
        sellerUsername: dispute.protectedTxn.seller?.username ?? null,
        amountMinor: dispute.protectedTxn.totalChargeMinor ?? null,
        currency: dispute.protectedTxn.currency ?? null,
        createdAt: dispute.createdAt,
      },
    });
  }

  // Persist → activityVersion (clears hiddenAt) → admin markRead → notify.
  // Party stays unread; Inbox softList on PAYMENT_DISPUTE + MESSAGE.
  const { message, activityVersion } = await prisma.$transaction(async (tx) => {
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
    const version = await bumpConversationActivity(conversation.id, tx, {
      touchLastMessage: true,
    });
    await markRead(conversation.id, opts.adminUserId, tx);
    return { message: msg, activityVersion: version };
  });

  await createNotification({
    userId: partyId,
    type: "PAYMENT_DISPUTE",
    title: "Message from Source Bridge",
    body: "You have a private message about an item review.",
    href: `/inbox/${conversation.id}`,
    actorId: opts.adminUserId,
    actorName: "Source Bridge",
    dedupeKey: `admin-dispute-msg:${message.id}`,
  });

  return {
    message,
    conversationId: conversation.id,
    partyId,
    activityVersion,
  };
}
