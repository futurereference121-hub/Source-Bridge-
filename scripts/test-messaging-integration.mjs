/**
 * Integration smoke test for messaging models (Prisma / Neon).
 * Does not print passwords. Uses disposable test users.
 * Run: node --env-file=.env scripts/test-messaging-integration.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const A = {
  email: "messenger-a@sourcebridge.test",
  name: "Messenger Alpha",
  username: "messenger_a",
};
const B = {
  email: "messenger-b@sourcebridge.test",
  name: "Messenger Beta",
  username: "messenger_b",
};
const C = {
  email: "messenger-c@sourcebridge.test",
  name: "Messenger Charlie",
  username: "messenger_c",
};

async function ensureUser(input) {
  const email = input.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        emailVerified: true,
        onboardingComplete: true,
        username: existing.username || input.username,
        slug: existing.slug || input.username,
        name: existing.name || input.name,
        city: existing.city || "Bangkok",
        country: existing.country || "Thailand",
      },
    });
  }
  return prisma.user.create({
    data: {
      email,
      name: input.name,
      username: input.username,
      slug: input.username,
      emailVerified: true,
      onboardingComplete: true,
      identityVerified: false,
      identityVerificationStatus: "UNVERIFIED",
      role: "USER",
      city: "Bangkok",
      country: "Thailand",
      intent: "both",
      specialties: "[]",
    },
  });
}

function assert(name, cond) {
  if (!cond) throw new Error(`FAIL: ${name}`);
  console.log(`OK   ${name}`);
}

try {
  const userA = await ensureUser(A);
  const userB = await ensureUser(B);
  const userC = await ensureUser(C);
  assert("test users ready", Boolean(userA.id && userB.id && userC.id));

  const clientRequestId = `itest_${Date.now()}`;
  const now = new Date();

  const { conversation, sourcingRequest } = await prisma.$transaction(
    async (tx) => {
      const sr = await tx.sourcingRequest.create({
        data: {
          fromUserId: userA.id,
          toUserId: userB.id,
          message: "Looking for a working vintage camera in Tokyo",
          neededFrom: "Tokyo, Japan",
          budget: "$300",
          deadline: "2099-09-15",
          referenceImages: "[]",
          clientRequestId,
          status: "open",
        },
      });
      const conv = await tx.conversation.create({
        data: {
          subject: "Sourcing request",
          contextType: "sourcing",
          sourcingRequestId: sr.id,
          lastMessageAt: now,
          participants: {
            create: [
              { userId: userA.id, lastReadAt: now },
              { userId: userB.id },
            ],
          },
        },
      });
      const msg = await tx.message.create({
        data: {
          conversationId: conv.id,
          senderId: userA.id,
          body: sr.message,
          messageType: "SOURCING_REQUEST",
          clientMessageId: `${clientRequestId}_msg`,
          createdAt: now,
        },
      });
      return { conversation: conv, sourcingRequest: sr, message: msg };
    },
  );

  assert("conversation created", Boolean(conversation.id));
  assert("structured fields stored", sourcingRequest.neededFrom === "Tokyo, Japan");
  assert("budget stored", sourcingRequest.budget === "$300");

  const unreadForB = await prisma.message.count({
    where: {
      conversationId: conversation.id,
      senderId: { not: userB.id },
    },
  });
  assert("recipient has unread", unreadForB >= 1);

  const partC = await prisma.conversationParticipant.findUnique({
    where: {
      conversationId_userId: {
        conversationId: conversation.id,
        userId: userC.id,
      },
    },
  });
  assert("third user is not a participant", !partC);

  const reply = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      senderId: userB.id,
      body: "I can help — I know a shop in Shimokitazawa.",
      clientMessageId: `reply_${Date.now()}`,
    },
  });
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: new Date() },
  });
  assert("recipient can reply", Boolean(reply.id));

  const dup = await prisma.sourcingRequest.findFirst({
    where: { fromUserId: userA.id, clientRequestId },
  });
  assert("idempotency key stored once", dup?.id === sourcingRequest.id);

  // Cleanup this run's conversation (keep users for manual UI testing)
  await prisma.message.deleteMany({ where: { conversationId: conversation.id } });
  await prisma.conversationParticipant.deleteMany({
    where: { conversationId: conversation.id },
  });
  await prisma.conversation.delete({ where: { id: conversation.id } });
  await prisma.sourcingRequest.delete({ where: { id: sourcingRequest.id } });

  console.log("\nIntegration messaging tests passed.");
  console.log(
    "Manual UI: sign in as messenger-a / messenger-b (email magic/passwordless as configured) and use Explore → real members.",
  );
  console.log(`Users: ${A.email} → ${B.email}`);
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
