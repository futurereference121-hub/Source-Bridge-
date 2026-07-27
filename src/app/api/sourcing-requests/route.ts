import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { assertDailyLimit, recordDailyAction } from "@/lib/rate-limit";
import {
  mapConversation,
  participantUserSelect,
} from "@/lib/messaging";
import { jsonError, sourcingRequestSchema } from "@/lib/validation";

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (!user.emailVerified) return jsonError("Verify email first", 403);
    if (!user.onboardingComplete) {
      return jsonError("Complete your profile before sending a sourcing request", 403);
    }

    const body = await req.json();
    const parsed = sourcingRequestSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }

    const { toUserId, message, listingId, opportunityId } = parsed.data;

    if (toUserId === user.id) {
      return jsonError("You cannot send a sourcing request to yourself", 400);
    }

    const recipient = await prisma.user.findUnique({
      where: { id: toUserId },
      select: { id: true, name: true },
    });
    if (!recipient) return jsonError("Recipient not found", 404);

    let title = "Sourcing request";
    if (listingId) {
      const listing = await prisma.stockListing.findUnique({
        where: { id: listingId },
        select: { id: true, name: true, userId: true },
      });
      if (!listing) return jsonError("Listing not found", 404);
      if (listing.userId !== toUserId) {
        return jsonError("Recipient does not own this listing", 400);
      }
      title = `Sourcing: ${listing.name}`;
    }
    if (opportunityId) {
      const opportunity = await prisma.opportunity.findUnique({
        where: { id: opportunityId },
        select: { id: true, title: true, userId: true },
      });
      if (!opportunity) return jsonError("Opportunity not found", 404);
      if (opportunity.userId !== toUserId) {
        return jsonError("Recipient does not own this opportunity", 400);
      }
      title = `Sourcing: ${opportunity.title}`;
    }

    const existingOpen = await prisma.sourcingRequest.findFirst({
      where: {
        fromUserId: user.id,
        toUserId,
        status: "open",
        listingId: listingId ?? null,
        opportunityId: opportunityId ?? null,
      },
      include: {
        conversation: {
          include: {
            participants: {
              include: { user: { select: participantUserSelect } },
            },
            messages: {
              orderBy: { createdAt: "desc" },
              take: 1,
              include: { attachments: true },
            },
          },
        },
      },
    });

    if (existingOpen?.conversation) {
      return Response.json({
        ok: true,
        existing: true,
        sourcingRequest: {
          id: existingOpen.id,
          status: existingOpen.status,
          listingId: existingOpen.listingId,
          opportunityId: existingOpen.opportunityId,
          createdAt: existingOpen.createdAt.toISOString(),
        },
        conversation: mapConversation(existingOpen.conversation, user.id),
      });
    }

    await assertDailyLimit(user.id, "sourcing");
    await assertDailyLimit(user.id, "message");
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const sourcingRequest = await tx.sourcingRequest.create({
        data: {
          fromUserId: user.id,
          toUserId,
          listingId: listingId ?? null,
          opportunityId: opportunityId ?? null,
          message,
          status: "open",
        },
      });

      const conversation = await tx.conversation.create({
        data: {
          subject: title,
          contextType: "sourcing",
          listingId: listingId ?? null,
          opportunityId: opportunityId ?? null,
          sourcingRequestId: sourcingRequest.id,
          lastMessageAt: now,
          participants: {
            create: [
              { userId: user.id, lastReadAt: now },
              { userId: toUserId },
            ],
          },
        },
      });

      const firstMessage = await tx.message.create({
        data: {
          conversationId: conversation.id,
          senderId: user.id,
          body: message,
          createdAt: now,
        },
      });

      const transaction = await tx.transaction.create({
        data: {
          status: "REQUESTED",
          buyerId: user.id,
          sellerId: toUserId,
          conversationId: conversation.id,
          sourcingRequestId: sourcingRequest.id,
          listingId: listingId ?? null,
          opportunityId: opportunityId ?? null,
          title,
          notes: message,
        },
      });

      const fullConversation = await tx.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
        include: {
          participants: {
            include: { user: { select: participantUserSelect } },
          },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { attachments: true },
          },
        },
      });

      return {
        sourcingRequest,
        conversation: fullConversation,
        message: firstMessage,
        transaction,
      };
    });

    // Count both the sourcing action and the opening message toward limits
    await recordDailyAction(user.id, "sourcing", now);
    await recordDailyAction(user.id, "message", now);

    return Response.json(
      {
        ok: true,
        existing: false,
        sourcingRequest: {
          id: result.sourcingRequest.id,
          status: result.sourcingRequest.status,
          listingId: result.sourcingRequest.listingId,
          opportunityId: result.sourcingRequest.opportunityId,
          createdAt: result.sourcingRequest.createdAt.toISOString(),
        },
        conversation: mapConversation(result.conversation, user.id),
        message: {
          id: result.message.id,
          conversationId: result.message.conversationId,
          senderId: result.message.senderId,
          body: result.message.body,
          createdAt: result.message.createdAt.toISOString(),
          attachments: [],
        },
        transaction: {
          id: result.transaction.id,
          status: result.transaction.status,
          buyerId: result.transaction.buyerId,
          sellerId: result.transaction.sellerId,
          title: result.transaction.title,
          createdAt: result.transaction.createdAt.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message =
      err instanceof Error ? err.message : "Failed to create sourcing request";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status === 429) return jsonError(message, 429);
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[sourcing-requests]", err);
    return jsonError(message, status);
  }
}
