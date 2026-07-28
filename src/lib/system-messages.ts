import { prisma } from "@/lib/db";

export async function sendVerificationResultMessage(opts: {
  userId: string;
  approved: boolean;
  rejectionReason?: string;
  requestId: string;
}) {
  const subject = "Identity verification update";
  const body = opts.approved
    ? "Your identity has been successfully verified. Your verified badge is now active.\n\nManage verification: /profile/settings/verification"
    : `Your identity-verification request was declined.${
        opts.rejectionReason ? `\n\nReason: ${opts.rejectionReason}` : ""
      }\n\nYou can submit a new request here: /profile/settings/verification`;
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
        systemEventType: opts.approved ? "VERIFICATION_APPROVED" : "VERIFICATION_REJECTED",
        replyAllowed: false,
      },
    });
  });
}
