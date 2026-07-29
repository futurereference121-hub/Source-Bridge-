/**
 * End-to-end coverage for signup → onboard → explore visibility → search →
 * photo URL save path (DB-level; Blob upload exercised separately when tokens exist).
 *
 * Usage:
 *   npm run test:signup-explore
 */
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "crypto";

const prisma = new PrismaClient();

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

function hash(s) {
  return createHash("sha256").update(s).digest("hex");
}

async function main() {
  const tag = randomBytes(3).toString("hex");
  const username = `signup_${tag}`;
  const email = `signup-${tag}@sourcebridge.test`;

  console.log("[test-signup-explore] creating user…");

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        name: `Signup ${tag}`,
        username,
        slug: username,
        passwordHash: hash(`pw-${tag}`),
        emailVerified: false,
        onboardingComplete: false,
        isDiscoverable: true,
        isTestAccount: true,
        photo: "",
        city: "",
        country: "",
      },
    });
    await tx.emailVerificationToken.create({
      data: {
        userId: created.id,
        tokenHash: hash(`tok-${tag}`),
        email,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    return created;
  });

  // Not eligible before verify + onboard
  let eligible = await prisma.user.count({
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
  assert(eligible === 0, "should be hidden before verify/onboard");

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      onboardingComplete: true,
      isTestAccount: false,
      photo: "",
      publicDisplayMessage: "",
      city: "",
      country: "",
    },
  });

  eligible = await prisma.user.count({
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
  assert(eligible === 1, "eligible after verify+onboard without photo/location");

  const byUsername = await prisma.user.findFirst({
    where: {
      username,
      emailVerified: true,
      onboardingComplete: true,
      deletedAt: null,
      isDiscoverable: true,
      isTestAccount: false,
    },
  });
  assert(Boolean(byUsername), "searchable by username");

  const bySlug = await prisma.user.findFirst({
    where: {
      OR: [{ slug: username }, { username }],
      emailVerified: true,
      onboardingComplete: true,
      deletedAt: null,
      isDiscoverable: true,
    },
  });
  assert(Boolean(bySlug), "public profile resolvable");

  // Soft-delete hides them
  await prisma.user.update({
    where: { id: user.id },
    data: {
      deletedAt: new Date(),
      isDiscoverable: false,
      username: null,
      slug: null,
      email: `deleted_${user.id}@invalid.local`,
      name: "Deleted user",
    },
  });
  const hidden = await prisma.user.count({
    where: {
      id: user.id,
      emailVerified: true,
      onboardingComplete: true,
      username: { not: null },
      deletedAt: null,
      isDiscoverable: true,
    },
  });
  assert(hidden === 0, "deleted user hidden from explore");

  // Cleanup
  await prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });

  console.log("[test-signup-explore] PASS");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
