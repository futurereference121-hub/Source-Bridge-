import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import {
  findOrCreateDirectConversation,
  getUnreadCount,
  mapConversation,
  participantUserSelect,
} from "@/lib/messaging";
import { createConversationSchema, jsonError } from "@/lib/validation";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export async function GET(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const sp = req.nextUrl.searchParams;
    const cursor = sp.get("cursor") || undefined;
    const limit = Math.min(
      Math.max(Number(sp.get("limit") || DEFAULT_LIMIT) || DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );

    const rowsPromise = prisma.conversation.findMany({
      where: {
        participants: {
          some: { userId: user.id, leftAt: null, hiddenAt: null },
        },
      },
      orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        participants: {
          include: { user: { select: participantUserSelect } },
        },
        messages: {
          where: {
            hides: { none: { userId: user.id } },
          },
          orderBy: { createdAt: "desc" },
          take: 8,
          include: { attachments: true },
        },
        sourcingRequest: true,
        listing: {
          select: {
            id: true,
            name: true,
            images: true,
            price: true,
            currency: true,
            slug: true,
          },
        },
      },
    });

    const [rows, unreadCount] = await Promise.all([
      rowsPromise,
      getUnreadCount(user.id),
    ]);

    const slice = rows.slice(0, limit).map((c) => {
      const mine = c.participants.find((p) => p.userId === user.id);
      const cutoff = mine?.deletedBeforeAt?.getTime() ?? 0;
      const visibleMessages =
        cutoff > 0
          ? c.messages.filter((m) => m.createdAt.getTime() > cutoff)
          : c.messages;
      return mapConversation(
        {
          ...c,
          messages: visibleMessages.slice(0, 1),
        },
        user.id,
      );
    });

    return Response.json({
      conversations: slice,
      nextCursor: rows.length > limit ? rows[limit - 1]?.id ?? null : null,
      unreadCount,
    }, {
      headers: {
        "Cache-Control": "private, no-store, no-cache, must-revalidate",
        Vary: "Cookie",
      },
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[conversations:list]", err);
    return jsonError("Failed to load conversations", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (!user.emailVerified) return jsonError("Verify email first", 403);
    if (!user.onboardingComplete) {
      return jsonError("Complete your profile before messaging", 403);
    }

    const body = await req.json();
    const parsed = createConversationSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }

    const { conversation, message, created } = await findOrCreateDirectConversation({
      fromUserId: user.id,
      toUserId: parsed.data.toUserId,
      contextType: parsed.data.contextType,
      listingId: parsed.data.listingId,
      opportunityId: parsed.data.opportunityId,
      subject: parsed.data.subject,
      initialMessage: parsed.data.initialMessage,
    });

    return Response.json(
      {
        ok: true,
        created,
        conversation: mapConversation(conversation, user.id),
        message: {
          id: message.id,
          conversationId: message.conversationId,
          senderId: message.senderId,
          body: message.body,
          createdAt: message.createdAt.toISOString(),
          attachments: message.attachments.map((a) => ({
            id: a.id,
            url: a.url,
            pathname: a.pathname,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
          })),
        },
      },
      { status: created ? 201 : 200 },
    );
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : "Failed to create conversation";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status === 429) return jsonError(message, 429);
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[conversations:create]", err);
    return jsonError(message, status);
  }
}
