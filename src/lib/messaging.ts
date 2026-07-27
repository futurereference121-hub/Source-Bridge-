import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assertDailyLimit, recordDailyAction } from "@/lib/rate-limit";
import { pathnameBelongsToUser } from "@/lib/storage";

const participantUserSelect = {
  id: true,
  name: true,
  username: true,
  slug: true,
  photo: true,
} as const;

export type ParticipantUser = {
  id: string;
  name: string;
  username: string | null;
  slug: string | null;
  photo: string;
};

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
    where: { userId, leftAt: null },
    select: { conversationId: true, lastReadAt: true },
  });
  if (participations.length === 0) return 0;

  return prisma.message.count({
    where: {
      OR: participations.map((p) => ({
        conversationId: p.conversationId,
        senderId: { not: userId },
        ...(p.lastReadAt ? { createdAt: { gt: p.lastReadAt } } : {}),
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
    throwHttp("Not a participant of this conversation", 403);
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

async function findExistingDirectConversation(opts: {
  fromUserId: string;
  toUserId: string;
  contextType: string;
  listingId?: string | null;
  opportunityId?: string | null;
}) {
  return prisma.conversation.findFirst({
    where: {
      contextType: opts.contextType,
      closedAt: null,
      listingId: opts.listingId ?? null,
      opportunityId: opts.opportunityId ?? null,
      AND: [
        { participants: { some: { userId: opts.fromUserId, leftAt: null } } },
        { participants: { some: { userId: opts.toUserId, leftAt: null } } },
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
    select: { id: true },
  });
  if (!recipient) throwHttp("Recipient not found", 404);

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

  const result = await prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.create({
      data: {
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
  senderId: string;
  body: string;
  createdAt: Date;
  attachments?: { id: string; url: string; pathname: string; mimeType: string; sizeBytes: number }[];
  sender?: ParticipantUser;
}) {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    attachments: (m.attachments ?? []).map((a) => ({
      id: a.id,
      url: a.url,
      pathname: a.pathname,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
    })),
    sender: m.sender
      ? {
          id: m.sender.id,
          name: m.sender.name,
          username: m.sender.username,
          slug: m.sender.slug,
          photo: m.sender.photo,
        }
      : undefined,
  };
}

export function mapConversation(
  c: {
    id: string;
    subject: string;
    contextType: string;
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
      senderId: string;
      body: string;
      createdAt: Date;
      attachments?: {
        id: string;
        url: string;
        pathname: string;
        mimeType: string;
        sizeBytes: number;
      }[];
    }[];
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

  return {
    id: c.id,
    subject: c.subject,
    contextType: c.contextType,
    listingId: c.listingId,
    opportunityId: c.opportunityId,
    sourcingRequestId: c.sourcingRequestId,
    closedAt: c.closedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    lastMessage,
    unread,
    participants: (c.participants ?? []).map((p) => ({
      userId: p.userId,
      lastReadAt: p.lastReadAt?.toISOString() ?? null,
      leftAt: p.leftAt?.toISOString() ?? null,
      user: p.user
        ? {
            id: p.user.id,
            name: p.user.name,
            username: p.user.username,
            slug: p.user.slug,
            photo: p.user.photo,
          }
        : undefined,
    })),
  };
}

export { participantUserSelect, safePathname };
