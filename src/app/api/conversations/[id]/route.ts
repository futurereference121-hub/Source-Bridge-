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
import {
  isPaymentsTestRampOpen,
  userMatchesPaymentsAllowlist,
} from "@/lib/payments/allowlist";
import {
  isInstantPaymentsEnabled,
  isProtectedPaymentsEnabled,
} from "@/lib/payments/flags";
import { jsonError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RECENT_MESSAGES = 30;

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const user = await requireSessionUser();
    const { id } = await params;
    const isPoll = new URL(_req.url).searchParams.get("poll") === "1";

    await requireParticipant(id, user.id);

    // Repair orphan tickets on initial open only — polling must not delay chat.
    if (!isPoll) {
      await ensureConversationPaymentTicketMessages(id);
    }

    const conversation = await prisma.conversation.findUnique({
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

    if (!conversation) return jsonError("Conversation not found", 404);

    if (!isPoll) {
      await markRead(id, user.id);
    }

    // Authoritative tickets for this conversation (all, not just recent page).
    const paymentTickets = await listConversationPaymentTickets(id);
    const activePaymentTicketCount = paymentTickets.filter((t) =>
      isActiveLifecycleTicket({
        ticketStatus: t.status,
        protectedStatus: t.protectedTxnStatus ?? null,
        lifecycleStage: t.lifecycleStage ?? null,
      }),
    ).length;
    const messagesAsc = [...conversation.messages].reverse().map(mapMessage);
    // Merge ALL tickets even when only recent N messages are loaded so older
    // ticket cards never vanish due to pagination. Dedupes by paymentTicketId.
    const messages = mergePaymentTicketsIntoTimeline(
      id,
      messagesAsc,
      paymentTickets,
    );

    // TEST ramp: when Live is off, eligible authenticated parties can propose.
    // Peer presence still required; demo/admin eligibility is enforced on create.
    const activeParts = conversation.participants.filter((p) => !p.leftAt);
    const peerPart = activeParts.find((p) => p.userId !== user.id);
    const identityRows = await prisma.user.findMany({
      where: {
        id: {
          in: [user.id, ...(peerPart ? [peerPart.userId] : [])],
        },
      },
      select: { id: true, email: true },
    });
    const byId = new Map(identityRows.map((r) => [r.id, r]));
    const selfIdentity = byId.get(user.id) || {
      id: user.id,
      email: user.email,
    };
    const peerIdentity = peerPart ? byId.get(peerPart.userId) : null;
    const rampOpen = isPaymentsTestRampOpen();
    const selfAllowed = rampOpen || userMatchesPaymentsAllowlist(selfIdentity);
    const peerAllowed = peerIdentity
      ? rampOpen || userMatchesPaymentsAllowlist(peerIdentity)
      : false;
    const paymentsProposalAccess = {
      allowlistConfigured: rampOpen ? false : true,
      testRampOpen: rampOpen,
      flagsOn: Boolean(
        isProtectedPaymentsEnabled() || isInstantPaymentsEnabled(),
      ),
      selfAllowed,
      peerAllowed,
      /** True when POST create can pass TEST access for both parties. */
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
        messages,
        paymentTickets,
        activePaymentTicketCount,
        maxActivePaymentTickets: MAX_ACTIVE_PAYMENT_TICKETS,
        canCreatePaymentTicket:
          activePaymentTicketCount < MAX_ACTIVE_PAYMENT_TICKETS,
        paymentsProposalAccess,
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
      err instanceof Error ? err.message : "Failed to load conversation";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[conversations:get]", err);
    return jsonError(message, status);
  }
}
