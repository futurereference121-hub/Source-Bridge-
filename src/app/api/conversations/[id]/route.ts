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
