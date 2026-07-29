/**
 * Creates a temporary account, verifies Explore eligibility rules, exercises
 * profile photo URL persistence, then fully deletes the account and asserts
 * it leaves no public traces.
 *
 * Usage:
 *   npm run test:production-stability
 */
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "crypto";

const prisma = new PrismaClient();

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

function hash(s) {
  return createHash("sha256").update(String(s)).digest("hex");
}

async function purgeAndDelete(userId) {
  await prisma.statusUpdate.deleteMany({ where: { userId } });
  await prisma.opportunity.deleteMany({ where: { userId } });
  await prisma.stockListing.deleteMany({ where: { userId } });
  await prisma.networkLocation.deleteMany({ where: { userId } });
  await prisma.trip.deleteMany({ where: { userId } });
  await prisma.notification.deleteMany({
    where: { OR: [{ userId }, { actorId: userId }] },
  });
  await prisma.identityVerificationRequest.deleteMany({ where: { userId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.emailVerificationToken.deleteMany({ where: { userId } });
  await prisma.passwordResetToken.deleteMany({ where: { userId } });
  await prisma.follow.deleteMany({
    where: { OR: [{ followerId: userId }, { followingId: userId }] },
  });
  await prisma.conversationParticipant.deleteMany({ where: { userId } });
  await prisma.message.updateMany({
    where: { senderId: userId },
    data: { senderId: null },
  });
  await prisma.user.delete({ where: { id: userId } });
}

async function main() {
  const tag = randomBytes(3).toString("hex");
  const username = `e2e_stab_${tag}`;
  const email = `e2e-stab-${tag}@sourcebridge.test`;

  console.log("[test:production-stability] create…", username);

  const user = await prisma.user.create({
    data: {
      email,
      name: `E2E Stability ${tag}`,
      username,
      slug: username,
      passwordHash: hash(`pw-${tag}`),
      emailVerified: true,
      onboardingComplete: true,
      isDiscoverable: true,
      isTestAccount: false,
      photo: `https://example.public.blob.vercel-storage.com/avatars/temp/${tag}.jpg`,
      city: "Lisbon",
      country: "Portugal",
      publicDisplayMessage: "Stability probe",
    },
  });

  await prisma.statusUpdate.create({
    data: {
      userId: user.id,
      text: "temp status",
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  await prisma.opportunity.create({
    data: {
      userId: user.id,
      title: "temp opp",
      description: "temp",
      city: "Lisbon",
      country: "Portugal",
      category: "General",
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

  const eligible = await prisma.user.count({
    where: {
      id: user.id,
      emailVerified: true,
      onboardingComplete: true,
      username: { not: null },
      slug: { not: null },
      deletedAt: null,
      isDiscoverable: true,
      isTestAccount: false,
      role: { not: "ADMIN" },
      isAdmin: false,
    },
  });
  assert(eligible === 1, "temp user should be Explore-eligible");

  const searchable = await prisma.user.findFirst({
    where: {
      username,
      deletedAt: null,
      isDiscoverable: true,
      onboardingComplete: true,
      emailVerified: true,
    },
  });
  assert(Boolean(searchable), "searchable by username");
  assert(Boolean(searchable.photo), "photo URL stored");

  console.log("[test:production-stability] delete…");
  await purgeAndDelete(user.id);

  const gone = await prisma.user.findUnique({ where: { id: user.id } });
  assert(!gone, "user hard-deleted");

  const statusLeft = await prisma.statusUpdate.count({
    where: { userId: user.id },
  });
  const oppLeft = await prisma.opportunity.count({ where: { userId: user.id } });
  const notifLeft = await prisma.notification.count({
    where: { OR: [{ userId: user.id }, { actorId: user.id }] },
  });
  assert(statusLeft === 0 && oppLeft === 0 && notifLeft === 0, "no public orphans");

  const usernameReuse = await prisma.user.findFirst({
    where: { username },
  });
  assert(!usernameReuse, "username free after delete");

  console.log("[test:production-stability] PASS");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
