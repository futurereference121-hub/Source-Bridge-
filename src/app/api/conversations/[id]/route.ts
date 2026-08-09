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
} from "@/lib/payments/tickets";
import {
  isPaymentsTestAllowlistConfigured,
  userMatchesPaymentsAllowlist,
} from "@/lib/payments/allowlist";
import {
  isInstantPaymentsEnabled,
  isProtectedPaymentsEnabled,
} from "@/lib/payments/flags";
import { jsonError } from "@/lib/validation";

const RECENT_MESSAGES = 30;

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const user = await requireSessionUser();
    const { id } = await params;

    await requireParticipant(id, user.id);

    // Repair orphan tickets so Payment Ticket cards always appear in chat.
    await ensureConversationPaymentTicketMessages(id);

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

    await markRead(id, user.id);

    // Authoritative tickets for this conversation (all, not just recent page).
    const paymentTickets = await listConversationPaymentTickets(id);
    const messagesAsc = [...conversation.messages].reverse().map(mapMessage);
    // Merge ALL tickets even when only recent N messages are loaded so older
    // ticket cards never vanish due to pagination. Dedupes by paymentTicketId.
    const messages = mergePaymentTicketsIntoTimeline(
      id,
      messagesAsc,
      paymentTickets,
    );

    // Dual-party allowlist gate for chat propose (UI vs POST create).
    // Self-only allowlist is enough to *show* the form; *create* still needs both.
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
    const allowlistConfigured = isPaymentsTestAllowlistConfigured();
    const selfAllowed =
      allowlistConfigured && userMatchesPaymentsAllowlist(selfIdentity);
    const peerAllowed = peerIdentity
      ? allowlistConfigured && userMatchesPaymentsAllowlist(peerIdentity)
      : false;
    const paymentsProposalAccess = {
      allowlistConfigured,
      flagsOn: Boolean(
        isProtectedPaymentsEnabled() || isInstantPaymentsEnabled(),
      ),
      selfAllowed,
      peerAllowed,
      /** True only when POST create can pass both-party allowlist. */
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
        paymentsProposalAccess,
      },
      {
        headers: {
          "Cache-Control": "no-store",
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
