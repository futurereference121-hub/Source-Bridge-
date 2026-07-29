/**
 * Safe production cleanup of obvious test / QA / automated accounts.
 *
 * Identifies candidates by username/email/name patterns and isTestAccount.
 * Never touches adminsource or an explicit allow-list of genuine usernames.
 *
 * Usage:
 *   npm run cleanup-production-tests -- --dry-run   # list only
 *   npm run cleanup-production-tests                # soft-delete + purge public content
 *   npm run cleanup-production-tests -- --hard      # hard-delete rows after content purge
 */
import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";

const prisma = new PrismaClient();

const ADMIN_USERNAME = "adminsource";
/** Known genuine production members — never auto-delete. */
const PROTECTED_USERNAMES = new Set([
  ADMIN_USERNAME,
  "bellahap",
  "theowlsaid",
]);

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const HARD = args.has("--hard");

function isObviousTestUsername(username) {
  if (!username) return false;
  const u = username.toLowerCase();
  return (
    u.startsWith("e2e_user_") ||
    u.startsWith("e2e_") ||
    u.startsWith("signup_") ||
    u.startsWith("deltest_") ||
    u.startsWith("delpeer_") ||
    u.startsWith("messenger_") ||
    u.startsWith("bellatuaeva_") || // repair-script artifact from incomplete signup
    /^test[_-]/.test(u) ||
    u.includes("__deleted__")
  );
}

function isObviousTestEmail(email) {
  if (!email) return false;
  const e = email.toLowerCase();
  return (
    e.endsWith("@sourcebridge.test") ||
    e.endsWith("@example.com") ||
    e.startsWith("messenger-") ||
    e.startsWith("signup-") ||
    e.startsWith("delete-test-") ||
    e.startsWith("delete-peer-") ||
    e.startsWith("e2e-")
  );
}

function isObviousTestName(name) {
  if (!name) return false;
  const n = name.toLowerCase();
  return (
    n === "e2e tester" ||
    n === "blob test" ||
    n === "delete target" ||
    n === "delete peer" ||
    n.startsWith("signup ")
  );
}

async function findCandidates() {
  const users = await prisma.user.findMany({
    where: {
      OR: [{ username: null }, { username: { not: ADMIN_USERNAME } }],
      role: { not: "ADMIN" },
      isAdmin: false,
    },
    select: {
      id: true,
      email: true,
      username: true,
      slug: true,
      name: true,
      isTestAccount: true,
      deletedAt: true,
      photo: true,
      cover: true,
    },
  });

  return users.filter((u) => {
    const handle = (u.username || "").toLowerCase();
    if (PROTECTED_USERNAMES.has(handle)) return false;
    if (u.isTestAccount) return true;
    if (isObviousTestUsername(u.username)) return true;
    if (isObviousTestEmail(u.email)) return true;
    if (isObviousTestName(u.name) && !u.username) return true;
    if (isObviousTestName(u.name) && isObviousTestUsername(u.username)) {
      return true;
    }
    // Incomplete Blob/QA stubs with no username and no completed profile.
    if (
      !u.username &&
      (u.name === "Blob Test" || u.email?.includes("blob") || u.email?.includes("test"))
    ) {
      return true;
    }
    return false;
  });
}

async function purgePublicContent(userId) {
  const listingIds = (
    await prisma.stockListing.findMany({
      where: { userId },
      select: { id: true },
    })
  ).map((l) => l.id);
  const opportunityIds = (
    await prisma.opportunity.findMany({
      where: { userId },
      select: { id: true },
    })
  ).map((o) => o.id);

  const counts = {
    statuses: 0,
    opportunities: 0,
    listings: 0,
    notifications: 0,
    sessions: 0,
    verification: 0,
    follows: 0,
    reviews: 0,
    network: 0,
    trips: 0,
  };

  await prisma.$transaction(
    async (tx) => {
      if (listingIds.length) {
        await tx.conversation.updateMany({
          where: { listingId: { in: listingIds } },
          data: { listingId: null },
        });
        await tx.sourcingRequest.updateMany({
          where: { listingId: { in: listingIds } },
          data: { listingId: null },
        });
        await tx.transaction.updateMany({
          where: { listingId: { in: listingIds } },
          data: { listingId: null },
        });
      }
      if (opportunityIds.length) {
        await tx.conversation.updateMany({
          where: { opportunityId: { in: opportunityIds } },
          data: { opportunityId: null },
        });
        await tx.sourcingRequest.updateMany({
          where: { opportunityId: { in: opportunityIds } },
          data: { opportunityId: null },
        });
        await tx.transaction.updateMany({
          where: { opportunityId: { in: opportunityIds } },
          data: { opportunityId: null },
        });
      }

      counts.statuses = (
        await tx.statusUpdate.deleteMany({ where: { userId } })
      ).count;
      counts.opportunities = (
        await tx.opportunity.deleteMany({ where: { userId } })
      ).count;
      counts.listings = (
        await tx.stockListing.deleteMany({ where: { userId } })
      ).count;
      counts.network = (
        await tx.networkLocation.deleteMany({ where: { userId } })
      ).count;
      counts.trips = (await tx.trip.deleteMany({ where: { userId } })).count;
      counts.reviews =
        (await tx.review.deleteMany({ where: { revieweeId: userId } })).count +
        (await tx.review.deleteMany({ where: { reviewerId: userId } })).count;
      counts.follows =
        (await tx.follow.deleteMany({ where: { followerId: userId } })).count +
        (
          await tx.follow.deleteMany({
            where: { followingId: userId, followingIsSeed: false },
          })
        ).count;
      counts.notifications = (
        await tx.notification.deleteMany({
          where: { OR: [{ userId }, { actorId: userId }] },
        })
      ).count;
      counts.verification = (
        await tx.identityVerificationRequest.deleteMany({ where: { userId } })
      ).count;
      counts.sessions = (
        await tx.session.deleteMany({ where: { userId } })
      ).count;
      await tx.emailVerificationToken.deleteMany({ where: { userId } });
      await tx.passwordResetToken.deleteMany({ where: { userId } });
      await tx.rateLimitEvent.deleteMany({ where: { userId } });
      await tx.sellerPaymentMethod.deleteMany({ where: { userId } });
      await tx.conversationBlock.deleteMany({ where: { userId } });

      await tx.conversationParticipant.updateMany({
        where: { userId, leftAt: null },
        data: { leftAt: new Date() },
      });
    },
    { timeout: 60_000 },
  );

  // System-only conversations outside the main tx to avoid timeouts.
  const parts = await prisma.conversationParticipant.findMany({
    where: { userId },
    select: {
      conversationId: true,
      conversation: {
        select: {
          contextType: true,
          participants: { select: { userId: true } },
        },
      },
    },
  });
  const soleSystem = parts
    .filter(
      (p) =>
        p.conversation.contextType === "system" &&
        p.conversation.participants.length === 1,
    )
    .map((p) => p.conversationId);
  if (soleSystem.length) {
    await prisma.conversation.deleteMany({ where: { id: { in: soleSystem } } });
  }

  return counts;
}

async function softDeleteUser(user) {
  const hash = createHash("sha256").update(user.id).digest("hex").slice(0, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      name: "Deleted user",
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
      isTestAccount: true,
      deletedAt: new Date(),
    },
  });
  return hash;
}

async function main() {
  console.log(
    `\n[cleanup-production-tests] ${DRY_RUN ? "DRY RUN" : HARD ? "HARD DELETE" : "SOFT DELETE + PURGE"}\n`,
  );

  const candidates = await findCandidates();
  console.log(`Candidates: ${candidates.length}`);
  for (const u of candidates) {
    console.log(
      ` - ${u.username || "(no-user)"} | ${u.email} | name="${u.name}" | id=${u.id} | deleted=${Boolean(u.deletedAt)} | testFlag=${u.isTestAccount}`,
    );
  }

  if (DRY_RUN) {
    console.log("\nDry run complete — no writes.");
    return;
  }

  const report = [];
  for (const user of candidates) {
    const counts = await purgePublicContent(user.id);
    if (HARD) {
      // Remove remaining participations/messages where safe, then user row.
      const parts = await prisma.conversationParticipant.findMany({
        where: { userId: user.id },
        select: { conversationId: true },
      });
      for (const p of parts) {
        const others = await prisma.conversationParticipant.count({
          where: {
            conversationId: p.conversationId,
            userId: { not: user.id },
          },
        });
        if (others === 0) {
          await prisma.message.deleteMany({
            where: { conversationId: p.conversationId },
          });
          await prisma.conversationParticipant.deleteMany({
            where: { conversationId: p.conversationId },
          });
          await prisma.conversation.delete({
            where: { id: p.conversationId },
          }).catch(() => null);
        }
      }
      await prisma.conversationParticipant.deleteMany({
        where: { userId: user.id },
      });
      await prisma.message.updateMany({
        where: { senderId: user.id },
        data: { senderId: null },
      });
      await prisma.user.delete({ where: { id: user.id } });
      report.push({
        id: user.id,
        username: user.username,
        action: "hard-deleted",
        ...counts,
      });
    } else {
      await softDeleteUser(user);
      report.push({
        id: user.id,
        username: user.username,
        action: "soft-deleted+purged",
        ...counts,
      });
    }
  }

  // Ensure admin stays non-discoverable.
  await prisma.user.updateMany({
    where: { username: ADMIN_USERNAME },
    data: { isDiscoverable: false, role: "ADMIN", isAdmin: true },
  });

  console.log("\n=== Removal report ===");
  let totals = {
    statuses: 0,
    opportunities: 0,
    listings: 0,
    notifications: 0,
  };
  for (const r of report) {
    console.log(
      `- ${r.action} @${r.username || "(none)"} id=${r.id} statuses=${r.statuses} opps=${r.opportunities} listings=${r.listings} notifs=${r.notifications}`,
    );
    totals.statuses += r.statuses;
    totals.opportunities += r.opportunities;
    totals.listings += r.listings;
    totals.notifications += r.notifications;
  }
  console.log(
    `\nAccounts removed: ${report.length}; content purged: statuses=${totals.statuses} opps=${totals.opportunities} listings=${totals.listings} notifs=${totals.notifications}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
