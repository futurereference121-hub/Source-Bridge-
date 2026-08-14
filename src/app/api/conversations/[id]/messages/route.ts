import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { assertDailyLimit, recordDailyAction } from "@/lib/rate-limit";
import {
  assertNotBlocked,
  isAllowedAttachmentUrl,
  mapMessage,
  markRead,
  participantUserSelect,
  requireParticipant,
  safePathname,
} from "@/lib/messaging";
import {
  ensureConversationPaymentTicketMessages,
  listConversationPaymentTickets,
  mergePaymentTicketsIntoTimeline,
} from "@/lib/payments/tickets";
import { jsonError, sendMessageSchema } from "@/lib/validation";
import { createNotifications } from "@/lib/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await requireSessionUser();
    const { id } = await params;
    await requireParticipant(id, user.id);

    // Backfill timeline messages for tickets missing their chat card row.
    await ensureConversationPaymentTicketMessages(id);

    const sp = req.nextUrl.searchParams;
    const cursor = sp.get("cursor") || undefined;
    const limit = Math.min(
      Math.max(Number(sp.get("limit") || DEFAULT_LIMIT) || DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );

    const rows = await prisma.message.findMany({
      where: { conversationId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        attachments: true,
        sender: { select: participantUserSelect },
      },
    });

    const slice = rows.slice(0, limit);
    // Return chronological (oldest → newest) for chat UI
    const mapped = [...slice].reverse().map(mapMessage);
    // Authoritative tickets for this conversation (all, not just page).
    // Merge so paginated window cannot hide older tickets.
    const paymentTickets = await listConversationPaymentTickets(id);
    const messages = mergePaymentTicketsIntoTimeline(
      id,
      mapped,
      paymentTickets,
    );

    return Response.json(
      {
        messages,
        paymentTickets,
        nextCursor: rows.length > limit ? slice[slice.length - 1]?.id ?? null : null,
      },
      {
        headers: {
          "Cache-Control": "private, no-store, no-cache, must-revalidate",
        },
      },
    );
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message =
      err instanceof Error ? err.message : "Failed to load messages";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[messages:list]", err);
    return jsonError(message, status);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireSessionUser();
    if (!user.emailVerified) return jsonError("Verify email first", 403);
    if (!user.onboardingComplete) {
      return jsonError("Complete your profile before messaging", 403);
    }

    const { id } = await params;
    await requireParticipant(id, user.id);
    await assertNotBlocked(id);

    const body = await req.json();
    const parsed = sendMessageSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid message", 400);
    }

    for (const url of parsed.data.attachmentUrls) {
      if (!isAllowedAttachmentUrl(url, user.id)) {
        return jsonError("Invalid attachment URL for this account", 400);
      }
    }

    const peers = await prisma.conversationParticipant.findMany({
      where: { conversationId: id, userId: { not: user.id } },
      select: {
        leftAt: true,
        user: { select: { deletedAt: true, name: true } },
      },
    });
    const peerUnavailable = peers.some(
      (p) =>
        Boolean(p.leftAt) ||
        Boolean(p.user.deletedAt) ||
        p.user.name === "Deleted user",
    );
    if (peerUnavailable) {
      return jsonError("This account is no longer available", 403);
    }

    await assertDailyLimit(user.id, "message");
    const now = new Date();
    const clientMessageId = parsed.data.clientMessageId || "";

    if (clientMessageId) {
      const existing = await prisma.message.findFirst({
        where: { conversationId: id, clientMessageId, senderId: user.id },
        include: {
          attachments: true,
          sender: { select: participantUserSelect },
        },
      });
      if (existing) {
        return Response.json({
          ok: true,
          existing: true,
          message: mapMessage(existing),
        });
      }
    }

    const message = await prisma.$transaction(async (tx) => {
      const msg = await tx.message.create({
        data: {
          conversationId: id,
          senderId: user.id,
          body: parsed.data.text,
          clientMessageId,
          createdAt: now,
          attachments:
            parsed.data.attachmentUrls.length > 0
              ? {
                  create: parsed.data.attachmentUrls.map((url) => ({
                    url,
                    pathname: safePathname(url),
                  })),
                }
              : undefined,
        },
        include: {
          attachments: true,
          sender: { select: participantUserSelect },
        },
      });
      await tx.conversation.update({
        where: { id },
        data: { lastMessageAt: now, updatedAt: now },
      });
      await markRead(id, user.id, tx);
      return msg;
    });

    const limit = await recordDailyAction(user.id, "message", now);

    if (message.senderId && message.messageType !== "SYSTEM") {
      const others = await prisma.conversationParticipant.findMany({
        where: { conversationId: id, userId: { not: user.id }, leftAt: null },
        select: { userId: true },
      });
      const actorName = user.username ? `@${user.username}` : user.name;
      await createNotifications(
        others.map((p) => ({
          userId: p.userId,
          type: "MESSAGE" as const,
          title: `New message from ${actorName}`,
          href: `/inbox/${id}`,
          actorId: user.id,
          actorName,
        })),
      );
    }

    return Response.json(
      {
        ok: true,
        message: mapMessage(message),
        limit,
      },
      { status: 201 },
    );
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message =
      err instanceof Error ? err.message : "Failed to send message";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status === 429) return jsonError(message, 429);
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[messages:send]", err);
    return jsonError(message, status);
  }
}
