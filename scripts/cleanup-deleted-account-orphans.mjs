/**
 * One-time / repeatable cleanup for content left behind by soft-deleted accounts.
 *
 * Finds and removes:
 *   - statuses, opportunities, listings owned by deleted users
 *   - network locations, trips, reviews (written + received)
 *   - follows, notifications (as recipient or actor), verification requests
 *   - sessions and auth tokens for deleted users
 * Re-anonymizes poorly soft-deleted users so username/slug/photo/PII are cleared.
 *
 * Never touches active (deletedAt = null) accounts or adminsource.
 *
 * Usage:
 *   npm run cleanup-deleted-orphans            # apply changes
 *   npm run cleanup-deleted-orphans -- --dry-run
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ADMIN_USERNAME = "adminsource";
const DELETED_USER_NAME = "Deleted user";
const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");

function anonymizedEmail(userId) {
  return `deleted_${userId}@invalid.local`;
}

async function main() {
  console.log(
    `\n[cleanup-deleted-orphans] ${DRY_RUN ? "DRY RUN — no writes" : "APPLYING changes"}\n`,
  );

  const deletedUsers = await prisma.user.findMany({
    where: {
      deletedAt: { not: null },
      NOT: { username: ADMIN_USERNAME },
    },
    select: {
      id: true,
      name: true,
      username: true,
      slug: true,
      email: true,
      photo: true,
      cover: true,
      bio: true,
      publicDisplayMessage: true,
      city: true,
      country: true,
      passwordHash: true,
    },
  });

  console.log(`Soft-deleted users found: ${deletedUsers.length}`);

  const deletedIds = deletedUsers.map((u) => u.id);
  const summary = {
    usersReAnonymized: 0,
    statuses: 0,
    opportunities: 0,
    listings: 0,
    networkLocations: 0,
    trips: 0,
    reviews: 0,
    follows: 0,
    notifications: 0,
    verificationRequests: 0,
    sessions: 0,
    emailTokens: 0,
    passwordTokens: 0,
    rateLimitEvents: 0,
    paymentMethods: 0,
  };

  if (deletedIds.length === 0) {
    console.log("Nothing to clean. Exiting.");
    return;
  }

  // Count orphans before delete.
  const [
    statusCount,
    oppCount,
    listingCount,
    networkCount,
    tripCount,
    reviewReceived,
    reviewWritten,
    followAsFollower,
    followAsFollowing,
    notifAsUser,
    notifAsActor,
    verifCount,
    sessionCount,
    emailTokenCount,
    passwordTokenCount,
    rateLimitCount,
    paymentCount,
  ] = await Promise.all([
    prisma.statusUpdate.count({ where: { userId: { in: deletedIds } } }),
    prisma.opportunity.count({ where: { userId: { in: deletedIds } } }),
    prisma.stockListing.count({ where: { userId: { in: deletedIds } } }),
    prisma.networkLocation.count({ where: { userId: { in: deletedIds } } }),
    prisma.trip.count({ where: { userId: { in: deletedIds } } }),
    prisma.review.count({ where: { revieweeId: { in: deletedIds } } }),
    prisma.review.count({ where: { reviewerId: { in: deletedIds } } }),
    prisma.follow.count({ where: { followerId: { in: deletedIds } } }),
    prisma.follow.count({
      where: { followingId: { in: deletedIds }, followingIsSeed: false },
    }),
    prisma.notification.count({ where: { userId: { in: deletedIds } } }),
    prisma.notification.count({ where: { actorId: { in: deletedIds } } }),
    prisma.identityVerificationRequest.count({
      where: { userId: { in: deletedIds } },
    }),
    prisma.session.count({ where: { userId: { in: deletedIds } } }),
    prisma.emailVerificationToken.count({
      where: { userId: { in: deletedIds } },
    }),
    prisma.passwordResetToken.count({ where: { userId: { in: deletedIds } } }),
    prisma.rateLimitEvent.count({ where: { userId: { in: deletedIds } } }),
    prisma.sellerPaymentMethod.count({ where: { userId: { in: deletedIds } } }),
  ]);

  console.log("Orphan / leftover counts for deleted users:");
  console.log(`  statuses: ${statusCount}`);
  console.log(`  opportunities: ${oppCount}`);
  console.log(`  listings: ${listingCount}`);
  console.log(`  network locations: ${networkCount}`);
  console.log(`  trips: ${tripCount}`);
  console.log(`  reviews received: ${reviewReceived}`);
  console.log(`  reviews written: ${reviewWritten}`);
  console.log(`  follows (as follower): ${followAsFollower}`);
  console.log(`  follows (as following): ${followAsFollowing}`);
  console.log(`  notifications (recipient): ${notifAsUser}`);
  console.log(`  notifications (actor): ${notifAsActor}`);
  console.log(`  verification requests: ${verifCount}`);
  console.log(`  sessions: ${sessionCount}`);
  console.log(`  email tokens: ${emailTokenCount}`);
  console.log(`  password tokens: ${passwordTokenCount}`);
  console.log(`  rate limit events: ${rateLimitCount}`);
  console.log(`  payment methods: ${paymentCount}`);

  const needsReAnonymize = deletedUsers.filter(
    (u) =>
      u.username ||
      u.slug ||
      u.photo ||
      u.cover ||
      u.bio ||
      u.publicDisplayMessage ||
      u.city ||
      u.country ||
      u.passwordHash ||
      u.name !== DELETED_USER_NAME ||
      !u.email.startsWith("deleted_"),
  );
  console.log(
    `\nPoorly anonymized deleted users: ${needsReAnonymize.length}`,
  );
  for (const u of needsReAnonymize.slice(0, 20)) {
    console.log(
      `  - ${u.id} name="${u.name}" username=${u.username} slug=${u.slug}`,
    );
  }

  if (DRY_RUN) {
    console.log("\nDry run complete — no changes written.");
    return;
  }

  // Null FKs on listings/opportunities before delete (same as live deletion).
  const listingIds = (
    await prisma.stockListing.findMany({
      where: { userId: { in: deletedIds } },
      select: { id: true },
    })
  ).map((l) => l.id);
  const opportunityIds = (
    await prisma.opportunity.findMany({
      where: { userId: { in: deletedIds } },
      select: { id: true },
    })
  ).map((o) => o.id);

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

      summary.statuses = (
        await tx.statusUpdate.deleteMany({
          where: { userId: { in: deletedIds } },
        })
      ).count;
      summary.opportunities = (
        await tx.opportunity.deleteMany({
          where: { userId: { in: deletedIds } },
        })
      ).count;
      summary.listings = (
        await tx.stockListing.deleteMany({
          where: { userId: { in: deletedIds } },
        })
      ).count;
      summary.networkLocations = (
        await tx.networkLocation.deleteMany({
          where: { userId: { in: deletedIds } },
        })
      ).count;
      summary.trips = (
        await tx.trip.deleteMany({ where: { userId: { in: deletedIds } } })
      ).count;

      const r1 = await tx.review.deleteMany({
        where: { revieweeId: { in: deletedIds } },
      });
      const r2 = await tx.review.deleteMany({
        where: { reviewerId: { in: deletedIds } },
      });
      summary.reviews = r1.count + r2.count;

      const f1 = await tx.follow.deleteMany({
        where: { followerId: { in: deletedIds } },
      });
      const f2 = await tx.follow.deleteMany({
        where: { followingId: { in: deletedIds }, followingIsSeed: false },
      });
      summary.follows = f1.count + f2.count;

      const n1 = await tx.notification.deleteMany({
        where: { userId: { in: deletedIds } },
      });
      const n2 = await tx.notification.deleteMany({
        where: { actorId: { in: deletedIds } },
      });
      summary.notifications = n1.count + n2.count;

      summary.verificationRequests = (
        await tx.identityVerificationRequest.deleteMany({
          where: { userId: { in: deletedIds } },
        })
      ).count;
      summary.sessions = (
        await tx.session.deleteMany({ where: { userId: { in: deletedIds } } })
      ).count;
      summary.emailTokens = (
        await tx.emailVerificationToken.deleteMany({
          where: { userId: { in: deletedIds } },
        })
      ).count;
      summary.passwordTokens = (
        await tx.passwordResetToken.deleteMany({
          where: { userId: { in: deletedIds } },
        })
      ).count;
      summary.rateLimitEvents = (
        await tx.rateLimitEvent.deleteMany({
          where: { userId: { in: deletedIds } },
        })
      ).count;
      summary.paymentMethods = (
        await tx.sellerPaymentMethod.deleteMany({
          where: { userId: { in: deletedIds } },
        })
      ).count;

      // Mark remaining participations as left.
      await tx.conversationParticipant.updateMany({
        where: { userId: { in: deletedIds }, leftAt: null },
        data: { leftAt: new Date() },
      });

      for (const u of needsReAnonymize) {
        await tx.user.update({
          where: { id: u.id },
          data: {
            name: DELETED_USER_NAME,
            username: null,
            slug: null,
            email: anonymizedEmail(u.id),
            photo: "",
            cover: "",
            bio: "",
            publicDisplayMessage: "",
            city: "",
            country: "",
            memberType: "",
            specialties: "[]",
            passwordHash: null,
            mustChangePassword: false,
            emailVerified: false,
            identityVerified: false,
            identityVerificationStatus: "UNVERIFIED",
            onboardingComplete: false,
            isDiscoverable: false,
            isTestAccount: false,
          },
        });
        summary.usersReAnonymized += 1;
      }
    },
    { timeout: 60_000 },
  );

  console.log("\n=== Cleanup summary ===");
  for (const [key, value] of Object.entries(summary)) {
    console.log(`  ${key}: ${value}`);
  }
  console.log("\nDone.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
