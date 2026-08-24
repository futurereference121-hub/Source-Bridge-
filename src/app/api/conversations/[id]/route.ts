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
import {
  conversationActivityAt,
  getConversationActivityVersion,
} from "@/lib/conversation-activity";
import {
  getParticipantDeleteCutoff,
  messageVisibleToUserWhere,
  ticketsVisibleAfterDeleteCutoff,
} from "@/lib/conversation-hide";
import { jsonError } from "@/lib/validation";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECENT_MESSAGES = 30;

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const user = await requireSessionUser();
    const { id } = await params;
    const url = new URL(_req.url);
    const isPoll = url.searchParams.get("poll") === "1";
    const since = url.searchParams.get("since") || "";
    const sinceVersionRaw = url.searchParams.get("sinceVersion") || "";
    const sinceVersion = sinceVersionRaw ? Number(sinceVersionRaw) : null;

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

    const deletedBeforeAt = await getParticipantDeleteCutoff(id, user.id);

    let activityAt: string | null = null;
    let activityVersion: number | null = null;
    if (isPoll && (since || sinceVersion != null)) {
      [activityAt, activityVersion] = await Promise.all([
        conversationActivityAt(id),
        getConversationActivityVersion(id),
      ]);
      const versionUnchanged =
        sinceVersion != null &&
        Number.isFinite(sinceVersion) &&
        activityVersion <= sinceVersion;
      const sinceMs = Date.parse(since);
      const activityMs = Date.parse(activityAt);
      const timeUnchanged =
        since &&
        Number.isFinite(sinceMs) &&
        Number.isFinite(activityMs) &&
        activityMs <= sinceMs;
      if (
        (sinceVersion != null && versionUnchanged) ||
        (sinceVersion == null && timeUnchanged)
      ) {
        return Response.json(
          {
            unchanged: true,
            viewerUserId: user.id,
            viewerUsername: user.username ?? null,
            activityAt,
            activityVersion,
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
          where: messageVisibleToUserWhere(user.id, deletedBeforeAt),
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

    const [conversation, paymentTickets, activityResolved, activityVersionResolved] =
      activityAt != null && activityVersion != null
        ? [
            ...(await Promise.all([conversationPromise, ticketsPromise])),
            activityAt,
            activityVersion,
          ]
        : await Promise.all([
            conversationPromise,
            ticketsPromise,
            conversationActivityAt(id),
            getConversationActivityVersion(id),
          ]);

    if (!conversation) return jsonError("Conversation not found", 404);

    if (!isPoll) {
      await markRead(id, user.id);
    }

    const ticketsForViewer = ticketsVisibleAfterDeleteCutoff(
      paymentTickets,
      deletedBeforeAt,
    );

    const activePaymentTicketCount = ticketsForViewer.filter((t) =>
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
      ticketsForViewer,
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
        paymentTickets: ticketsForViewer,
        activePaymentTicketCount,
        maxActivePaymentTickets: MAX_ACTIVE_PAYMENT_TICKETS,
        canCreatePaymentTicket:
          activePaymentTicketCount < MAX_ACTIVE_PAYMENT_TICKETS,
        paymentsProposalAccess,
        activityAt: activityResolved,
        activityVersion: activityVersionResolved,
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
  /** Legacy: hide/unhide */
  hidden: z.boolean().optional(),
  /** hide | delete | unhide — Delete sets per-user history cutoff; Hide does not. */
  action: z.enum(["hide", "delete", "unhide"]).optional(),
}).refine(
  (v) => v.hidden != null || v.action != null,
  { message: "Provide hidden or action" },
);

/** Per-user hide/delete conversation from inbox. Shared messages & tickets retained. */
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

    const action = parsed.data.action;
    const isDelete = action === "delete";
    const isHide =
      action === "hide" || parsed.data.hidden === true;
    const isUnhide =
      action === "unhide" || parsed.data.hidden === false;

    if (isDelete) {
      const { deleteConversationForUser } = await import(
        "@/lib/conversation-hide"
      );
      await deleteConversationForUser(id, user.id);
      return Response.json({
        ok: true,
        hidden: true,
        deleted: true,
        action: "delete",
      });
    }

    if (isHide) {
      const { hideConversationForUser } = await import(
        "@/lib/conversation-hide"
      );
      await hideConversationForUser(id, user.id);
      return Response.json({
        ok: true,
        hidden: true,
        deleted: false,
        action: "hide",
      });
    }

    if (isUnhide) {
      await prisma.conversationParticipant.update({
        where: {
          conversationId_userId: { conversationId: id, userId: user.id },
        },
        data: { hiddenAt: null },
      });
      return Response.json({
        ok: true,
        hidden: false,
        deleted: false,
        action: "unhide",
      });
    }

    return jsonError("Provide hide, delete, or unhide", 400);
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
