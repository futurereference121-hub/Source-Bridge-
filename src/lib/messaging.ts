import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertDailyLimit, recordDailyAction } from "@/lib/rate-limit";
import { pathnameBelongsToUser } from "@/lib/storage";
import { conversationPairKey } from "@/lib/conversation-pair";

export { conversationPairKey } from "@/lib/conversation-pair";

const participantUserSelect = {
  id: true,
  name: true,
  username: true,
  slug: true,
  photo: true,
  deletedAt: true,
} as const;

export type ParticipantUser = {
  id: string;
  name: string;
  username: string | null;
  slug: string | null;
  photo: string;
  deletedAt?: Date | null;
};

const DELETED_USER_DISPLAY_NAME = "Deleted user";

function isDeletedParticipant(u: { deletedAt?: Date | null; name: string }): boolean {
  return Boolean(u.deletedAt) || u.name === DELETED_USER_DISPLAY_NAME;
}

/** Renders a deleted/anonymized account as "Deleted user" with no photo or profile link. */
function displayParticipant(u: ParticipantUser) {
  if (isDeletedParticipant(u)) {
    return {
      id: u.id,
      name: DELETED_USER_DISPLAY_NAME,
      username: null,
      slug: null,
      photo: "",
    };
  }
  return {
    id: u.id,
    name: u.name,
    username: u.username,
    slug: u.slug,
    photo: u.photo,
  };
}

export function isAllowedAttachmentUrl(url: string, userId: string): boolean {
  if (!url || !url.trim()) return false;
  const value = url.trim();
  try {
    if (value.startsWith("https://")) {
      const parsed = new URL(value);
      const hostOk =
        parsed.hostname.endsWith(".public.blob.vercel-storage.com") ||
        parsed.hostname.endsWith(".blob.vercel-storage.com");
      if (!hostOk) return false;
      return pathnameBelongsToUser(parsed.pathname, userId);
    }
  } catch {
    return false;
  }
  const cleaned = value.replace(/^\//, "");
  if (cleaned.startsWith("uploads/")) {
    return pathnameBelongsToUser(cleaned.slice("uploads/".length), userId);
  }
  return false;
}

function throwHttp(message: string, status: number, code?: string): never {
  const err = new Error(message) as Error & { status: number; code?: string };
  err.status = status;
  if (code) err.code = code;
  throw err;
}

export async function ensureParticipant(
  conversationId: string,
  userId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
) {
  return tx.conversationParticipant.upsert({
    where: {
      conversationId_userId: { conversationId, userId },
    },
    create: { conversationId, userId },
    update: { leftAt: null },
  });
}

export async function markRead(
  conversationId: string,
  userId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const now = new Date();
  await tx.conversationParticipant.updateMany({
    where: { conversationId, userId, leftAt: null },
    data: { lastReadAt: now },
  });
  return now;
}

/** Count unread messages across all of the user's open participations. */
export async function getUnreadCount(userId: string): Promise<number> {
  const participations = await prisma.conversationParticipant.findMany({
    where: { userId, leftAt: null, hiddenAt: null },
    select: { conversationId: true, lastReadAt: true },
  });
  if (participations.length === 0) return 0;

  // Include SYSTEM messages (senderId is null) — Prisma `not: userId` skips nulls.
  return prisma.message.count({
    where: {
      OR: participations.map((p) => ({
        conversationId: p.conversationId,
        AND: [
          {
            OR: [{ senderId: null }, { senderId: { not: userId } }],
          },
          ...(p.lastReadAt ? [{ createdAt: { gt: p.lastReadAt } }] : []),
        ],
      })),
    },
  });
}

export async function requireParticipant(conversationId: string, userId: string) {
  const part = await prisma.conversationParticipant.findUnique({
    where: {
      conversationId_userId: { conversationId, userId },
    },
  });
  if (!part || part.leftAt) {
    throwHttp("Conversation not found", 404);
  }
  return part;
}

export async function assertNotBlocked(conversationId: string) {
  const block = await prisma.conversationBlock.findFirst({
    where: { conversationId },
    select: { id: true },
  });
  if (block) {
    throwHttp("This conversation is blocked", 403, "BLOCKED");
  }
}

/**
 * Find any open 1:1 conversation between two users, regardless of context
 * type or listing/opportunity reference. All communication between the same
 * pair lives in a single shared thread.
 */
export async function findOpenConversationBetweenUsers(
  fromUserId: string,
  toUserId: string,
) {
  return findExistingDirectConversation({ fromUserId, toUserId });
}

/**
 * Get or create the single 1:1 conversation for a user pair.
 * Uses pairKey unique constraint; retries on race.
 */
export async function getOrCreateConversationPair(
  fromUserId: string,
  toUserId: string,
  opts?: {
    contextType?: string;
    subject?: string;
    listingId?: string | null;
    opportunityId?: string | null;
    sourcingRequestId?: string | null;
    tx?: Prisma.TransactionClient;
  },
) {
  if (fromUserId === toUserId) {
    throwHttp("You cannot message yourself", 400);
  }
  const pairKey = conversationPairKey(fromUserId, toUserId);
  const client = opts?.tx ?? prisma;

  const existing = await client.conversation.findUnique({
    where: { pairKey },
    include: {
      participants: { include: { user: { select: participantUserSelect } } },
    },
  });
  if (existing) {
    if (existing.closedAt) {
      await client.conversation.update({
        where: { id: existing.id },
        data: { closedAt: null },
      });
    }
    await ensureParticipant(existing.id, fromUserId, client);
    await ensureParticipant(existing.id, toUserId, client);
    return { conversation: existing, created: false, pairKey };
  }

  try {
    const now = new Date();
    const conversation = await client.conversation.create({
      data: {
        pairKey,
        subject: opts?.subject || "",
        contextType: opts?.contextType || "direct",
        listingId: opts?.listingId ?? null,
        opportunityId: opts?.opportunityId ?? null,
        sourcingRequestId: opts?.sourcingRequestId ?? null,
        lastMessageAt: now,
        participants: {
          create: [
            { userId: fromUserId, lastReadAt: now },
            { userId: toUserId },
          ],
        },
      },
      include: {
        participants: { include: { user: { select: participantUserSelect } } },
      },
    });
    return { conversation, created: true, pairKey };
  } catch (err) {
    // Unique race — another request created the pair first.
    const code = (err as { code?: string }).code;
    if (code !== "P2002") throw err;
    const raced = await client.conversation.findUnique({
      where: { pairKey },
      include: {
        participants: { include: { user: { select: participantUserSelect } } },
      },
    });
    if (!raced) throw err;
    await ensureParticipant(raced.id, fromUserId, client);
    await ensureParticipant(raced.id, toUserId, client);
    return { conversation: raced, created: false, pairKey };
  }
}

async function findExistingDirectConversation(opts: {
  fromUserId: string;
  toUserId: string;
  contextType?: string;
  listingId?: string | null;
  opportunityId?: string | null;
}) {
  const pairKey = conversationPairKey(opts.fromUserId, opts.toUserId);
  const byKey = await prisma.conversation.findUnique({
    where: { pairKey },
    include: {
      participants: { include: { user: { select: participantUserSelect } } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { attachments: true },
      },
    },
  });
  if (
    byKey &&
    !byKey.closedAt &&
    byKey.contextType !== "system" &&
    byKey.contextType !== "admin_dispute"
  ) {
    return byKey;
  }

  // Legacy fallback before pairKey backfill completes.
  return prisma.conversation.findFirst({
    where: {
      closedAt: null,
      contextType: { notIn: ["system", "admin_dispute"] },
      AND: [
        { participants: { some: { userId: opts.fromUserId, leftAt: null } } },
        { participants: { some: { userId: opts.toUserId, leftAt: null } } },
        {
          participants: {
            none: {
              leftAt: null,
              userId: { notIn: [opts.fromUserId, opts.toUserId] },
            },
          },
        },
      ],
    },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
    include: {
      participants: { include: { user: { select: participantUserSelect } } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { attachments: true },
      },
    },
  });
}

export type FindOrCreateDirectConversationInput = {
  fromUserId: string;
  toUserId: string;
  contextType: string;
  listingId?: string | null;
  opportunityId?: string | null;
  subject?: string;
  initialMessage: string;
  attachmentUrls?: string[];
};

export async function findOrCreateDirectConversation(
  input: FindOrCreateDirectConversationInput,
) {
  const {
    fromUserId,
    toUserId,
    contextType,
    listingId = null,
    opportunityId = null,
    subject = "",
    initialMessage,
    attachmentUrls = [],
  } = input;

  if (fromUserId === toUserId) {
    throwHttp("You cannot message yourself", 400);
  }

  const recipient = await prisma.user.findUnique({
    where: { id: toUserId },
    select: { id: true, deletedAt: true, name: true },
  });
  if (!recipient || isDeletedParticipant(recipient)) {
    throwHttp("This account is no longer available", 404);
  }

  if (listingId) {
    const listing = await prisma.stockListing.findUnique({
      where: { id: listingId },
      select: { id: true },
    });
    if (!listing) throwHttp("Listing not found", 404);
  }
  if (opportunityId) {
    const opportunity = await prisma.opportunity.findUnique({
      where: { id: opportunityId },
      select: { id: true },
    });
    if (!opportunity) throwHttp("Opportunity not found", 404);
  }

  for (const url of attachmentUrls) {
    if (!isAllowedAttachmentUrl(url, fromUserId)) {
      throwHttp("Invalid attachment URL for this account", 400);
    }
  }

  const existing = await findExistingDirectConversation({
    fromUserId,
    toUserId,
    contextType,
    listingId,
    opportunityId,
  });

  if (existing) {
    await assertNotBlocked(existing.id);
    await assertDailyLimit(fromUserId, "message");
    const now = new Date();

    const message = await prisma.$transaction(async (tx) => {
      if (!existing.pairKey) {
        await tx.conversation.update({
          where: { id: existing.id },
          data: { pairKey: conversationPairKey(fromUserId, toUserId) },
        }).catch(() => null);
      }
      const msg = await tx.message.create({
        data: {
          conversationId: existing.id,
          senderId: fromUserId,
          body: initialMessage,
          createdAt: now,
          attachments:
            attachmentUrls.length > 0
              ? {
                  create: attachmentUrls.map((url) => ({
                    url,
                    pathname: safePathname(url),
                  })),
                }
              : undefined,
        },
        include: { attachments: true },
      });
      await tx.conversation.update({
        where: { id: existing.id },
        data: { lastMessageAt: now, updatedAt: now },
      });
      await markRead(existing.id, fromUserId, tx);
      return msg;
    });

    await recordDailyAction(fromUserId, "message", now);

    const refreshed = await prisma.conversation.findUniqueOrThrow({
      where: { id: existing.id },
      include: {
        participants: { include: { user: { select: participantUserSelect } } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { attachments: true },
        },
      },
    });

    return { conversation: refreshed, message, created: false };
  }

  await assertDailyLimit(fromUserId, "message");
  const now = new Date();
  const pairKey = conversationPairKey(fromUserId, toUserId);

  const result = await prisma.$transaction(async (tx) => {
    let conversation;
    try {
      conversation = await tx.conversation.create({
        data: {
          pairKey,
          subject: subject || "",
          contextType,
          listingId,
          opportunityId,
          lastMessageAt: now,
          participants: {
            create: [
              { userId: fromUserId, lastReadAt: now },
              { userId: toUserId },
            ],
          },
        },
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "P2002") throw err;
      const raced = await tx.conversation.findUnique({ where: { pairKey } });
      if (!raced) throw err;
      conversation = raced;
      await ensureParticipant(conversation.id, fromUserId, tx);
      await ensureParticipant(conversation.id, toUserId, tx);
    }

    const message = await tx.message.create({
      data: {
        conversationId: conversation.id,
        senderId: fromUserId,
        body: initialMessage,
        createdAt: now,
        attachments:
          attachmentUrls.length > 0
            ? {
                create: attachmentUrls.map((url) => ({
                  url,
                  pathname: safePathname(url),
                })),
              }
            : undefined,
      },
      include: { attachments: true },
    });

    await tx.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: now, updatedAt: now },
    });
    await markRead(conversation.id, fromUserId, tx);

    const full = await tx.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
      include: {
        participants: { include: { user: { select: participantUserSelect } } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { attachments: true },
        },
      },
    });

    return { conversation: full, message };
  });

  await recordDailyAction(fromUserId, "message", now);
  return { ...result, created: true };
}

function safePathname(url: string): string {
  try {
    if (url.startsWith("https://")) {
      return new URL(url).pathname.replace(/^\//, "");
    }
    return url.replace(/^\//, "").replace(/^uploads\//, "");
  } catch {
    return "";
  }
}

export function mapMessage(m: {
  id: string;
  conversationId: string;
  senderId: string | null;
  body: string;
  createdAt: Date;
  messageType?: string;
  systemEventType?: string;
  replyAllowed?: boolean;
  paymentTicketId?: string | null;
  attachments?: { id: string; url: string; pathname: string; mimeType: string; sizeBytes: number }[];
  sender?: ParticipantUser | null;
}) {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    messageType: m.messageType || "USER",
    systemEventType: m.systemEventType || "",
    replyAllowed: m.replyAllowed !== false,
    paymentTicketId: m.paymentTicketId || null,
    attachments: (m.attachments ?? []).map((a) => ({
      id: a.id,
      url: a.url,
      pathname: a.pathname,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
    })),
    sender: m.sender ? displayParticipant(m.sender) : undefined,
  };
}

export function mapSourcingRequestDetails(row: {
  id: string;
  message: string;
  neededFrom?: string | null;
  budget?: string | null;
  deadline?: string | null;
  referenceImages?: string | null;
  status: string;
  listingId: string | null;
  opportunityId: string | null;
  createdAt: Date;
} | null | undefined) {
  if (!row) return null;
  let images: string[] = [];
  try {
    const parsed = JSON.parse(row.referenceImages || "[]") as unknown;
    if (Array.isArray(parsed)) {
      images = parsed.filter((x): x is string => typeof x === "string");
    }
  } catch {
    images = [];
  }
  return {
    id: row.id,
    message: row.message,
    neededFrom: row.neededFrom || "",
    budget: row.budget || "",
    deadline: row.deadline || "",
    referenceImages: images,
    status: row.status,
    listingId: row.listingId,
    opportunityId: row.opportunityId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function conversationTypeLabel(contextType: string): string {
  switch (contextType) {
    case "sourcing":
      return "Sourcing Request";
    case "listing":
      return "Listing Enquiry";
    case "opportunity":
      return "Opportunity Enquiry";
    case "system":
      return "Official";
    case "admin_dispute":
      return "Source Bridge support";
    case "direct":
      return "General Message";
    default:
      return "Message";
  }
}

export function mapConversation(
  c: {
    id: string;
    subject: string;
    contextType: string;
    disputeCaseId?: string | null;
    paymentTicketId?: string | null;
    listingId: string | null;
    opportunityId: string | null;
    sourcingRequestId: string | null;
    closedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    lastMessageAt: Date | null;
    participants?: {
      userId: string;
      lastReadAt: Date | null;
      leftAt: Date | null;
      user?: ParticipantUser;
    }[];
    messages?: {
      id: string;
      conversationId: string;
      senderId: string | null;
      body: string;
      createdAt: Date;
      messageType?: string;
      attachments?: {
        id: string;
        url: string;
        pathname: string;
        mimeType: string;
        sizeBytes: number;
      }[];
    }[];
    sourcingRequest?: {
      id: string;
      message: string;
      neededFrom?: string | null;
      budget?: string | null;
      deadline?: string | null;
      referenceImages?: string | null;
      status: string;
      listingId: string | null;
      opportunityId: string | null;
      createdAt: Date;
    } | null;
    listing?: {
      id: string;
      name: string;
      images: string;
      price: number | null;
      currency: string;
      slug: string;
    } | null;
  },
  viewerId?: string,
) {
  const lastMessage = c.messages?.[0] ? mapMessage(c.messages[0]) : null;
  const myPart = viewerId
    ? c.participants?.find((p) => p.userId === viewerId)
    : undefined;
  const unread =
    viewerId && lastMessage && lastMessage.senderId !== viewerId
      ? !myPart?.lastReadAt ||
        new Date(lastMessage.createdAt).getTime() > myPart.lastReadAt.getTime()
      : false;

  let listingCover = "";
  let listingImages: string[] = [];
  if (c.listing?.images) {
    try {
      const parsed = JSON.parse(c.listing.images) as unknown;
      if (Array.isArray(parsed)) {
        listingImages = parsed.filter((x): x is string => typeof x === "string");
        listingCover = listingImages[0] || "";
      }
    } catch {
      listingCover = "";
    }
  }

  return {
    id: c.id,
    subject: c.subject,
    contextType: c.contextType,
    typeLabel: conversationTypeLabel(c.contextType),
    disputeCaseId: c.disputeCaseId ?? null,
    paymentTicketId: c.paymentTicketId ?? null,
    listingId: c.listingId,
    opportunityId: c.opportunityId,
    sourcingRequestId: c.sourcingRequestId,
    closedAt: c.closedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    lastMessage,
    unread,
    sourcingRequest: mapSourcingRequestDetails(c.sourcingRequest),
    listing: c.listing
      ? {
          id: c.listing.id,
          name: c.listing.name,
          cover: listingCover,
          price: c.listing.price,
          currency: c.listing.currency,
          slug: c.listing.slug,
        }
      : null,
    participants: (c.participants ?? []).map((p) => ({
      userId: p.userId,
      lastReadAt: p.lastReadAt?.toISOString() ?? null,
      leftAt: p.leftAt?.toISOString() ?? null,
      user: p.user ? displayParticipant(p.user) : undefined,
    })),
  };
}

export { participantUserSelect, safePathname };
