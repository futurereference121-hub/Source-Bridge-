import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const all = await prisma.user.findMany({
    where: { deletedAt: null, role: { not: "ADMIN" }, isAdmin: false },
    select: {
      id: true,
      username: true,
      name: true,
      emailVerified: true,
      onboardingComplete: true,
      isDiscoverable: true,
      isTestAccount: true,
      city: true,
      country: true,
      photo: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  console.log("Recent non-admin users:");
  for (const u of all) {
    const eligible =
      u.emailVerified &&
      u.onboardingComplete &&
      Boolean(u.username) &&
      u.isDiscoverable &&
      !u.isTestAccount;
    console.log(
      [
        eligible ? "OK" : "HIDE",
        u.username || "(no-user)",
        `verified=${u.emailVerified}`,
        `onboarded=${u.onboardingComplete}`,
        `discoverable=${u.isDiscoverable}`,
        `test=${u.isTestAccount}`,
        `city=${u.city || "-"}`,
        `photo=${u.photo ? "yes" : "no"}`,
        u.name,
      ].join(" | "),
    );
  }

  const eligible = await prisma.user.count({
    where: {
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
  console.log("\nEligible for Explore:", eligible);

  const stuckVerified = await prisma.user.count({
    where: {
      deletedAt: null,
      emailVerified: true,
      onboardingComplete: false,
      role: { not: "ADMIN" },
      isAdmin: false,
    },
  });
  console.log("Verified but not onboarded:", stuckVerified);

  const stuckUnverified = await prisma.user.count({
    where: {
      deletedAt: null,
      emailVerified: false,
      role: { not: "ADMIN" },
      isAdmin: false,
    },
  });
  console.log("Unverified accounts:", stuckUnverified);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
