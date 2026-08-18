import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import {
  mapConversation,
  mapMessage,
  markRead,
  participantUserSelect,
  requireParticipant,
} from "@/lib/messaging";
import {
  ensureConversationPaymentTicketMessages,
  listConversationPaymentTickets,
  mergePaymentTicketsIntoTimeline,
  MAX_ACTIVE_PAYMENT_TICKETS,
  isActiveLifecycleTicket,
} from "@/lib/payments/tickets";
import { backfillProductPurchaseTicketsForConversation } from "@/lib/payments/product-purchase-ticket";
import {
  isPaymentsTestRampOpen,
  userMatchesPaymentsAllowlist,
} from "@/lib/payments/allowlist";
import {
  isInstantPaymentsEnabled,
  isProtectedPaymentsEnabled,
} from "@/lib/payments/flags";
import { jsonError } from "@/lib/validation";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECENT_MESSAGES = 30;

type Params = { params: Promise<{ id: string }> };

async function conversationActivityAt(conversationId: string): Promise<string> {
  const [conv, ticketMax, protectedTxnMax, disputeMax] = await Promise.all([
    prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { lastMessageAt: true, updatedAt: true },
    }),
    prisma.paymentTicket.aggregate({
      where: { conversationId },
      _max: { updatedAt: true },
    }),
    prisma.protectedTransaction.aggregate({
      where: { conversationId },
      _max: { updatedAt: true },
    }),
    prisma.disputeCase.aggregate({
      where: {
        protectedTxn: {
          conversationId,
        },
      },
      _max: { updatedAt: true },
    }),
  ]);
  const latest = Math.max(
    conv?.lastMessageAt?.getTime() ?? 0,
    conv?.updatedAt?.getTime() ?? 0,
    ticketMax._max.updatedAt?.getTime() ?? 0,
    protectedTxnMax._max.updatedAt?.getTime() ?? 0,
    disputeMax._max.updatedAt?.getTime() ?? 0,
  );
  return new Date(latest || Date.now()).toISOString();
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const user = await requireSessionUser();
    const { id } = await params;
    const url = new URL(_req.url);
    const isPoll = url.searchParams.get("poll") === "1";
    const since = url.searchParams.get("since") || "";

    await requireParticipant(id, user.id);

    if (!isPoll) {
      await Promise.all([
        ensureConversationPaymentTicketMessages(id),
        backfillProductPurchaseTicketsForConversation(id).catch((err) => {
          console.error("[conversations:product-ticket-backfill]", err);
          return 0;
        }),
      ]);
    }

    let activityAt: string | null = null;
    if (isPoll && since) {
      activityAt = await conversationActivityAt(id);
      const sinceMs = Date.parse(since);
      const activityMs = Date.parse(activityAt);
      if (Number.isFinite(sinceMs) && Number.isFinite(activityMs) && activityMs <= sinceMs) {
        return Response.json(
          {
            unchanged: true,
            viewerUserId: user.id,
            viewerUsername: user.username ?? null,
            activityAt,
          },
          {
            headers: {
              "Cache-Control": "private, no-store, no-cache, must-revalidate",
              Vary: "Cookie",
            },
          },
        );
      }
    }

    const conversationPromise = prisma.conversation.findUnique({
      where: { id },
      include: {
        participants: {
          include: { user: { select: participantUserSelect } },
        },
        messages: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: RECENT_MESSAGES,
          include: {
            attachments: true,
            sender: { select: participantUserSelect },
          },
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
    const ticketsPromise = listConversationPaymentTickets(id, user.id, { skipExpire: isPoll });

    const [conversation, paymentTickets, activityResolved] = activityAt
      ? [
          ...(await Promise.all([conversationPromise, ticketsPromise])),
          activityAt,
        ]
      : await Promise.all([
          conversationPromise,
          ticketsPromise,
          conversationActivityAt(id),
        ]);

    if (!conversation) return jsonError("Conversation not found", 404);

    if (!isPoll) {
      await markRead(id, user.id);
    }

    const activePaymentTicketCount = paymentTickets.filter((t) =>
      isActiveLifecycleTicket({
        ticketStatus: t.status,
        protectedStatus: t.protectedTxnStatus ?? null,
        lifecycleStage: t.lifecycleStage ?? null,
        hiddenFromChatAt: t.hiddenFromChatAt ?? null,
        origin: t.origin ?? null,
      }),
    ).length;
    const messagesAsc = [...conversation.messages].reverse().map(mapMessage);
    const messages = mergePaymentTicketsIntoTimeline(
      id,
      messagesAsc,
      paymentTickets,
    );

    const activeParts = conversation.participants.filter((p) => !p.leftAt);
    const peerPart = activeParts.find((p) => p.userId !== user.id);
    const rampOpen = isPaymentsTestRampOpen();
    const selfAllowed = rampOpen || userMatchesPaymentsAllowlist({
      id: user.id,
      email: user.email,
    });
    const peerAllowed = peerPart
      ? rampOpen || userMatchesPaymentsAllowlist({ id: peerPart.userId })
      : false;
    const paymentsProposalAccess = {
      allowlistConfigured: rampOpen ? false : true,
      testRampOpen: rampOpen,
      flagsOn: Boolean(
        isProtectedPaymentsEnabled() || isInstantPaymentsEnabled(),
      ),
      selfAllowed,
      peerAllowed,
      bothAllowed: selfAllowed && peerAllowed,
      peerPresent: Boolean(peerPart),
    };

    return Response.json(
      {
        conversation: mapConversation(
          {
            ...conversation,
            messages: conversation.messages.slice(0, 1),
          },
          user.id,
        ),
        viewerUserId: user.id,
        viewerUsername: user.username ?? null,
        messages,
        paymentTickets,
        activePaymentTicketCount,
        maxActivePaymentTickets: MAX_ACTIVE_PAYMENT_TICKETS,
        canCreatePaymentTicket:
          activePaymentTicketCount < MAX_ACTIVE_PAYMENT_TICKETS,
        paymentsProposalAccess,
        activityAt: activityResolved,
      },
      {
        headers: {
          "Cache-Control": "private, no-store, no-cache, must-revalidate",
          Vary: "Cookie",
        },
      },
    );
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message =
      err instanceof Error ? err.message : "Failed to load conversation";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[conversations:get]", err);
    return jsonError(message, status);
  }
}

const patchSchema = z.object({
  hidden: z.boolean(),
});

/** Per-user hide/unhide conversation from inbox (P7). */
export async function PATCH(req: Request, { params }: Params) {
  try {
    const user = await requireSessionUser();
    const { id } = await params;
    await requireParticipant(id, user.id);

    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }

    await prisma.conversationParticipant.update({
      where: {
        conversationId_userId: { conversationId: id, userId: user.id },
      },
      data: {
        hiddenAt: parsed.data.hidden ? new Date() : null,
      },
    });

    return Response.json({ ok: true, hidden: parsed.data.hidden });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    if (status === 401) return jsonError("Sign in required", 401);
    if (status >= 400 && status < 500) {
      return jsonError(err instanceof Error ? err.message : "Failed", status);
    }
    console.error("[conversations:patch]", err);
    return jsonError("Failed to update conversation", status);
  }
}
