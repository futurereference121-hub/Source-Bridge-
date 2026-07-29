/**
 * Production integrity audit (+ optional safe repairs).
 *
 * Usage:
 *   npm run audit-production-integrity
 *   npm run audit-production-integrity -- --repair
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const REPAIR = process.argv.includes("--repair");

async function main() {
  console.log(
    `\n[audit-production-integrity] ${REPAIR ? "REPAIR MODE" : "READ-ONLY"}\n`,
  );

  const issues = [];

  const orphanStatuses = await prisma.statusUpdate.count({
    where: { user: { deletedAt: { not: null } } },
  });
  const orphanOpps = await prisma.opportunity.count({
    where: { user: { deletedAt: { not: null } } },
  });
  const orphanListings = await prisma.stockListing.count({
    where: { user: { deletedAt: { not: null } } },
  });
  issues.push({
    key: "orphans-for-deleted-users",
    statuses: orphanStatuses,
    opportunities: orphanOpps,
    listings: orphanListings,
  });

  const missingSlug = await prisma.user.count({
    where: {
      deletedAt: null,
      username: { not: null },
      slug: null,
      role: { not: "ADMIN" },
    },
  });
  issues.push({ key: "username-without-slug", count: missingSlug });

  const badDiscoverable = await prisma.user.count({
    where: {
      deletedAt: null,
      emailVerified: true,
      onboardingComplete: true,
      username: { not: null },
      isDiscoverable: false,
      isTestAccount: false,
      role: { not: "ADMIN" },
      isAdmin: false,
    },
  });
  issues.push({
    key: "eligible-but-not-discoverable",
    count: badDiscoverable,
  });

  const adminVisible = await prisma.user.count({
    where: {
      OR: [{ role: "ADMIN" }, { isAdmin: true }],
      isDiscoverable: true,
      deletedAt: null,
    },
  });
  issues.push({ key: "admin-still-discoverable", count: adminVisible });

  const dupUsernames = await prisma.$queryRaw`
    SELECT username, COUNT(*)::int AS count
    FROM "User"
    WHERE username IS NOT NULL
    GROUP BY username
    HAVING COUNT(*) > 1
  `;
  issues.push({ key: "duplicate-usernames", rows: dupUsernames });

  const brokenPhoto = await prisma.user.count({
    where: {
      deletedAt: null,
      photo: { contains: "example.com" },
    },
  });
  issues.push({ key: "placeholder-example-photos", count: brokenPhoto });

  console.log("Findings:");
  for (const issue of issues) {
    console.log(JSON.stringify(issue));
  }

  if (!REPAIR) {
    console.log("\nRe-run with --repair to apply safe fixes.");
    return;
  }

  let repaired = 0;

  if (orphanStatuses || orphanOpps || orphanListings) {
    const deletedIds = (
      await prisma.user.findMany({
        where: { deletedAt: { not: null } },
        select: { id: true },
      })
    ).map((u) => u.id);
    if (deletedIds.length) {
      repaired += (
        await prisma.statusUpdate.deleteMany({
          where: { userId: { in: deletedIds } },
        })
      ).count;
      repaired += (
        await prisma.opportunity.deleteMany({
          where: { userId: { in: deletedIds } },
        })
      ).count;
      repaired += (
        await prisma.stockListing.deleteMany({
          where: { userId: { in: deletedIds } },
        })
      ).count;
    }
  }

  const needSlug = await prisma.user.findMany({
    where: {
      deletedAt: null,
      username: { not: null },
      slug: null,
      role: { not: "ADMIN" },
    },
    select: { id: true, username: true },
  });
  for (const u of needSlug) {
    await prisma.user.update({
      where: { id: u.id },
      data: { slug: u.username },
    });
    repaired += 1;
  }

  repaired += (
    await prisma.user.updateMany({
      where: {
        deletedAt: null,
        emailVerified: true,
        onboardingComplete: true,
        username: { not: null },
        isDiscoverable: false,
        isTestAccount: false,
        role: { not: "ADMIN" },
        isAdmin: false,
      },
      data: { isDiscoverable: true },
    })
  ).count;

  repaired += (
    await prisma.user.updateMany({
      where: {
        OR: [{ role: "ADMIN" }, { isAdmin: true }],
        isDiscoverable: true,
      },
      data: { isDiscoverable: false },
    })
  ).count;

  repaired += (
    await prisma.user.updateMany({
      where: { deletedAt: null, photo: { contains: "example.com" } },
      data: { photo: "" },
    })
  ).count;

  console.log(`\nSafe repairs applied (row ops): ${repaired}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
