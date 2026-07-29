/**
 * Integration test: create a temporary user with public content, delete via
 * deleteOwnAccount logic (direct DB path mirroring the API), and assert public
 * surfaces no longer expose them.
 *
 * Usage:
 *   node --env-file=.env scripts/test-account-deletion.mjs
 */
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "crypto";

const prisma = new PrismaClient();
const DELETED_USER_NAME = "Deleted user";

function hashPasswordPlaceholder() {
  // Not used for login in this script — just needs a non-null hash field.
  return createHash("sha256").update(randomBytes(16)).digest("hex");
}

async function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

async function main() {
  const tag = randomBytes(4).toString("hex");
  const email = `delete-test-${tag}@sourcebridge.test`;
  const username = `deltest_${tag}`;
  const peerEmail = `delete-peer-${tag}@sourcebridge.test`;
  const peerUsername = `delpeer_${tag}`;

  console.log("[test-account-deletion] creating fixtures…");

  const peer = await prisma.user.create({
    data: {
      email: peerEmail,
      name: "Delete Peer",
      username: peerUsername,
      slug: peerUsername,
      emailVerified: true,
      onboardingComplete: true,
      isDiscoverable: true,
      isTestAccount: true,
      passwordHash: hashPasswordPlaceholder(),
      city: "London",
      country: "UK",
    },
  });

  const user = await prisma.user.create({
    data: {
      email,
      name: "Delete Target",
      username,
      slug: username,
      emailVerified: true,
      onboardingComplete: true,
      isDiscoverable: true,
      isTestAccount: true,
      passwordHash: hashPasswordPlaceholder(),
      photo: "https://example.com/photo.jpg",
      publicDisplayMessage: "Hello from delete test",
      city: "Tokyo",
      country: "Japan",
    },
  });

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.statusUpdate.create({
    data: {
      userId: user.id,
      text: "Status that must vanish",
      expiresAt,
    },
  });
  await prisma.opportunity.create({
    data: {
      userId: user.id,
      title: "Opp that must vanish",
      description: "Looking for widgets",
      city: "Tokyo",
      country: "Japan",
      category: "General",
      expiresAt,
    },
  });
  await prisma.notification.create({
    data: {
      userId: peer.id,
      type: "STATUS",
      title: "New status",
      actorId: user.id,
      actorName: `@${username}`,
      href: `/members/${username}`,
    },
  });
  await prisma.notification.create({
    data: {
      userId: user.id,
      type: "SYSTEM",
      title: "Welcome",
    },
  });

  const conversation = await prisma.conversation.create({
    data: {
      contextType: "direct",
      subject: "test",
      participants: {
        create: [{ userId: user.id }, { userId: peer.id }],
      },
      messages: {
        create: {
          senderId: user.id,
          body: "Hello peer",
        },
      },
    },
  });

  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: createHash("sha256").update(`session-${tag}`).digest("hex"),
      expiresAt: new Date(Date.now() + 86400000),
    },
  });

  // Inline deletion mirroring src/lib/account-deletion.ts (no Next.js imports).
  const opportunityIds = (
    await prisma.opportunity.findMany({
      where: { userId: user.id },
      select: { id: true },
    })
  ).map((o) => o.id);

  await prisma.$transaction(async (tx) => {
    if (opportunityIds.length) {
      await tx.conversation.updateMany({
        where: { opportunityId: { in: opportunityIds } },
        data: { opportunityId: null },
      });
    }
    await tx.statusUpdate.deleteMany({ where: { userId: user.id } });
    await tx.opportunity.deleteMany({ where: { userId: user.id } });
    await tx.stockListing.deleteMany({ where: { userId: user.id } });
    await tx.networkLocation.deleteMany({ where: { userId: user.id } });
    await tx.trip.deleteMany({ where: { userId: user.id } });
    await tx.review.deleteMany({ where: { revieweeId: user.id } });
    await tx.review.deleteMany({ where: { reviewerId: user.id } });
    await tx.follow.deleteMany({ where: { followerId: user.id } });
    await tx.follow.deleteMany({
      where: { followingId: user.id, followingIsSeed: false },
    });
    await tx.emailVerificationToken.deleteMany({ where: { userId: user.id } });
    await tx.passwordResetToken.deleteMany({ where: { userId: user.id } });
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.rateLimitEvent.deleteMany({ where: { userId: user.id } });
    await tx.sellerPaymentMethod.deleteMany({ where: { userId: user.id } });
    await tx.notification.deleteMany({
      where: { OR: [{ userId: user.id }, { actorId: user.id }] },
    });
    await tx.identityVerificationRequest.deleteMany({
      where: { userId: user.id },
    });
    await tx.conversationParticipant.updateMany({
      where: { userId: user.id, leftAt: null },
      data: { leftAt: new Date() },
    });
    await tx.user.update({
      where: { id: user.id },
      data: {
        name: DELETED_USER_NAME,
        username: null,
        slug: null,
        email: `deleted_${user.id}@invalid.local`,
        photo: "",
        cover: "",
        bio: "",
        publicDisplayMessage: "",
        city: "",
        country: "",
        passwordHash: null,
        emailVerified: false,
        identityVerified: false,
        identityVerificationStatus: "UNVERIFIED",
        onboardingComplete: false,
        isDiscoverable: false,
        isTestAccount: false,
        deletedAt: new Date(),
      },
    });
  });

  console.log("[test-account-deletion] asserting post-delete state…");

  const after = await prisma.user.findUnique({ where: { id: user.id } });
  await assert(after?.deletedAt != null, "user should be soft-deleted");
  await assert(after?.username == null, "username cleared");
  await assert(after?.slug == null, "slug cleared");
  await assert(after?.name === DELETED_USER_NAME, "name anonymized");
  await assert(!after?.photo, "photo cleared");
  await assert(!after?.publicDisplayMessage, "display message cleared");

  const statusLeft = await prisma.statusUpdate.count({
    where: { userId: user.id },
  });
  const oppLeft = await prisma.opportunity.count({ where: { userId: user.id } });
  await assert(statusLeft === 0, "no statuses remain");
  await assert(oppLeft === 0, "no opportunities remain");

  const publicHit = await prisma.user.findFirst({
    where: {
      OR: [{ username }, { slug: username }],
      deletedAt: null,
      isDiscoverable: true,
    },
  });
  await assert(!publicHit, "username must not resolve publicly");

  const feedStatus = await prisma.statusUpdate.count({
    where: {
      expiresAt: { gt: new Date() },
      user: { deletedAt: { not: null } },
    },
  });
  await assert(feedStatus === 0, "no deleted-user statuses in feed query");

  const sessions = await prisma.session.count({ where: { userId: user.id } });
  await assert(sessions === 0, "sessions deleted");

  const notifs = await prisma.notification.count({
    where: { OR: [{ userId: user.id }, { actorId: user.id }] },
  });
  await assert(notifs === 0, "notifications cleaned");

  const part = await prisma.conversationParticipant.findUnique({
    where: {
      conversationId_userId: {
        conversationId: conversation.id,
        userId: user.id,
      },
    },
  });
  await assert(part?.leftAt != null, "participant marked left");

  const peerStill = await prisma.user.findUnique({ where: { id: peer.id } });
  await assert(peerStill?.deletedAt == null, "peer account intact");
  await assert(peerStill?.username === peerUsername, "peer username intact");

  // Cleanup peer + deleted row (hard delete peer; keep soft-deleted for realism or remove)
  await prisma.message.deleteMany({ where: { conversationId: conversation.id } });
  await prisma.conversationParticipant.deleteMany({
    where: { conversationId: conversation.id },
  });
  await prisma.conversation.delete({ where: { id: conversation.id } });
  await prisma.user.delete({ where: { id: peer.id } });
  await prisma.user.delete({ where: { id: user.id } });

  console.log("[test-account-deletion] PASS");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
