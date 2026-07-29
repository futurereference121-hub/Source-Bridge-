import { prisma } from "@/lib/db";

const APPROVED_SUBJECT = "Identity Verification Approved";
const APPROVED_BODY = [
  "Congratulations!",
  "",
  "Your identity has been successfully verified.",
  "",
  "Your profile now displays the Verified Identity badge and you are now eligible to participate in Source Bridge protected features that require identity verification.",
  "",
  "Thank you for helping build a trusted global sourcing network.",
].join("\n");

/**
 * Official Source Bridge system inbox message for verification outcomes.
 * Creates a system conversation (single participant) so it appears in Inbox.
 */
export async function sendVerificationResultMessage(opts: {
  userId: string;
  approved: boolean;
  rejectionReason?: string;
  requestId?: string;
}) {
  const subject = opts.approved
    ? APPROVED_SUBJECT
    : "Identity Verification Update";
  const body = opts.approved
    ? APPROVED_BODY
    : [
        "Your identity-verification request was declined.",
        opts.rejectionReason ? `\nReason: ${opts.rejectionReason}` : "",
        "",
        "You can submit a new request from Profile → Settings → Verification.",
        "",
        "Manage verification: /profile/settings/verification",
      ]
        .filter(Boolean)
        .join("\n");

  return prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.create({
      data: {
        subject,
        contextType: "system",
        lastMessageAt: new Date(),
        participants: { create: { userId: opts.userId } },
      },
    });
    return tx.message.create({
      data: {
        conversationId: conversation.id,
        senderId: null,
        body,
        messageType: "SYSTEM",
        systemEventType: opts.approved
          ? "VERIFICATION_APPROVED"
          : "VERIFICATION_REJECTED",
        replyAllowed: false,
      },
    });
  });
}
