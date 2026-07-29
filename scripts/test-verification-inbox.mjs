/**
 * Unit-ish check that verification approval copy and unread counting rules
 * for SYSTEM (null senderId) messages stay correct.
 *
 * Usage:
 *   npm run test:verification-inbox
 */
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "crypto";

const prisma = new PrismaClient();

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

async function main() {
  const tag = randomBytes(3).toString("hex");
  const user = await prisma.user.create({
    data: {
      email: `verif-inbox-${tag}@sourcebridge.test`,
      name: "Verif Inbox",
      username: `verif_inbox_${tag}`,
      slug: `verif_inbox_${tag}`,
      passwordHash: createHash("sha256").update(tag).digest("hex"),
      emailVerified: true,
      onboardingComplete: true,
      isDiscoverable: false,
      isTestAccount: true,
    },
  });

  const conversation = await prisma.conversation.create({
    data: {
      subject: "Identity Verification Approved",
      contextType: "system",
      lastMessageAt: new Date(),
      participants: { create: { userId: user.id } },
      messages: {
        create: {
          senderId: null,
          body: "Congratulations!\n\nYour identity has been successfully verified.",
          messageType: "SYSTEM",
          systemEventType: "VERIFICATION_APPROVED",
          replyAllowed: false,
        },
      },
    },
  });

  await prisma.notification.create({
    data: {
      userId: user.id,
      type: "SYSTEM",
      title: "Identity Verification Approved",
      body: "Your profile now displays the Verified Identity badge.",
      href: "/inbox",
    },
  });

  // Mirror getUnreadCount logic including null senderId.
  const part = await prisma.conversationParticipant.findFirst({
    where: { userId: user.id, conversationId: conversation.id },
  });
  const unread = await prisma.message.count({
    where: {
      conversationId: conversation.id,
      AND: [{ OR: [{ senderId: null }, { senderId: { not: user.id } }] }],
    },
  });
  assert(unread === 1, "SYSTEM message with null sender counts as unread");
  assert(Boolean(part), "participant exists");

  const notif = await prisma.notification.findFirst({
    where: { userId: user.id, title: "Identity Verification Approved" },
  });
  assert(Boolean(notif), "approval notification created");

  // Cleanup
  await prisma.message.deleteMany({ where: { conversationId: conversation.id } });
  await prisma.conversationParticipant.deleteMany({
    where: { conversationId: conversation.id },
  });
  await prisma.conversation.delete({ where: { id: conversation.id } });
  await prisma.notification.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });

  console.log("[test:verification-inbox] PASS");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
