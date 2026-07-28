import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { assertDailyLimit, recordDailyAction } from "@/lib/rate-limit";
import {
  isAllowedAttachmentUrl,
  mapConversation,
  participantUserSelect,
} from "@/lib/messaging";
import { sendEmail } from "@/lib/email";
import { jsonError, sourcingRequestSchema } from "@/lib/validation";

function appUrl() {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

function mapSourcingRequest(row: {
  id: string;
  message: string;
  neededFrom: string;
  budget: string;
  deadline: string;
  referenceImages: string;
  status: string;
  listingId: string | null;
  opportunityId: string | null;
  createdAt: Date;
}) {
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
    neededFrom: row.neededFrom,
    budget: row.budget,
    deadline: row.deadline,
    referenceImages: images,
    status: row.status,
    listingId: row.listingId,
    opportunityId: row.opportunityId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (!user.emailVerified) return jsonError("Verify email first", 403);
    if (!user.onboardingComplete) {
      return jsonError(
        "Complete your profile before sending a sourcing request",
        403,
      );
    }

    const body = await req.json();
    const parsed = sourcingRequestSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }

    const {
      toUserId,
      message,
      neededFrom,
      budget,
      deadline,
      referenceImages,
      clientRequestId,
      listingId,
      opportunityId,
    } = parsed.data;

    if (toUserId === user.id) {
      return jsonError("You cannot send a sourcing request to yourself", 400);
    }

    const recipient = await prisma.user.findUnique({
      where: { id: toUserId },
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        emailVerified: true,
        onboardingComplete: true,
      },
    });
    if (!recipient) return jsonError("Recipient not found", 404);

    for (const url of referenceImages) {
      if (url.startsWith("blob:")) {
        return jsonError("Images are still uploading", 400);
      }
      if (!isAllowedAttachmentUrl(url, user.id)) {
        return jsonError("Invalid reference image for this account", 400);
      }
    }

    if (clientRequestId) {
      const prior = await prisma.sourcingRequest.findFirst({
        where: { fromUserId: user.id, clientRequestId },
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
      if (prior?.conversation) {
        return Response.json({
          ok: true,
          existing: true,
          sourcingRequest: mapSourcingRequest(prior),
          conversation: mapConversation(prior.conversation, user.id),
        });
      }
    }

    let title = "Sourcing request";
    let contextType = "sourcing";
    if (listingId) {
      const listing = await prisma.stockListing.findUnique({
        where: { id: listingId },
        select: { id: true, name: true, userId: true },
      });
      if (!listing) return jsonError("Listing not found", 404);
      if (listing.userId !== toUserId) {
        return jsonError("Recipient does not own this listing", 400);
      }
      title = `Listing enquiry: ${listing.name}`;
      contextType = "listing";
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
      title = `Opportunity enquiry: ${opportunity.title}`;
      contextType = "opportunity";
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
        sourcingRequest: mapSourcingRequest(existingOpen),
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
          neededFrom: neededFrom || "",
          budget: budget || "",
          deadline: deadline || "",
          referenceImages: JSON.stringify(referenceImages),
          clientRequestId: clientRequestId || "",
          status: "open",
        },
      });

      const conversation = await tx.conversation.create({
        data: {
          subject: title,
          contextType,
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
          messageType: "SOURCING_REQUEST",
          createdAt: now,
          attachments:
            referenceImages.length > 0
              ? {
                  create: referenceImages.map((url) => ({
                    url,
                    pathname: "",
                    mimeType: "image/*",
                    sizeBytes: 0,
                  })),
                }
              : undefined,
        },
      });

      // Stamp attachment order via pathname field lightly
      if (referenceImages.length) {
        const atts = await tx.messageAttachment.findMany({
          where: { messageId: firstMessage.id },
          orderBy: { createdAt: "asc" },
        });
        await Promise.all(
          atts.map((att, i) =>
            tx.messageAttachment.update({
              where: { id: att.id },
              data: { pathname: `order:${i}` },
            }),
          ),
        );
      }

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

      return {
        sourcingRequest,
        conversation: fullConversation,
        message: firstMessage,
        transaction,
      };
    });

    await recordDailyAction(user.id, "sourcing", now);
    await recordDailyAction(user.id, "message", now);

    // Best-effort email — never roll back the request
    if (recipient.email) {
      void sendEmail({
        to: recipient.email,
        subject: "You received a new sourcing request on Source Bridge",
        text: [
          `Hi ${recipient.name},`,
          "",
          `@${user.username || "A member"} sent you a sourcing request on Source Bridge.`,
          `Open your inbox: ${appUrl()}/inbox/${result.conversation.id}`,
          "",
          "This email does not include the private message contents.",
        ].join("\n"),
      }).catch(() => null);
    }

    return Response.json(
      {
        ok: true,
        existing: false,
        sourcingRequest: mapSourcingRequest(result.sourcingRequest),
        conversation: mapConversation(result.conversation, user.id),
        message: {
          id: result.message.id,
          conversationId: result.message.conversationId,
          senderId: result.message.senderId,
          body: result.message.body,
          createdAt: result.message.createdAt.toISOString(),
          attachments: [],
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
