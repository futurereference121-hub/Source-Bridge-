/**
 * READ-ONLY production audit: Trust Passport eligibility for username theowlsaid.
 * Diagnostic only — never hard-code results into runtime product logic.
 *
 * Usage: node --env-file=.env scripts/_audit-trust-passport-theowlsaid-readonly.mjs
 *
 * Does NOT create charges, transfers, releases, or refunds.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const USERNAME = "theowlsaid";

function isIdentityBadgeVisible(user) {
  if (user.identityVerified) return true;
  return (user.identityVerificationStatus || "").toUpperCase() === "VERIFIED";
}

async function main() {
  const user = await prisma.user.findFirst({
    where: { username: USERNAME },
    select: {
      id: true,
      username: true,
      identityVerified: true,
      identityVerificationStatus: true,
      deletedAt: true,
      isDemo: true,
      isTestAccount: true,
      isAdmin: true,
      role: true,
      createdAt: true,
    },
  });

  if (!user) {
    console.log(JSON.stringify({ ok: false, reason: "user_not_found", username: USERNAME }));
    return;
  }

  const liveConnect = await prisma.stripeConnectAccount.findUnique({
    where: {
      userId_stripeMode: { userId: user.id, stripeMode: "LIVE" },
    },
    select: {
      payoutsEnabled: true,
      chargesEnabled: true,
      detailsSubmitted: true,
      stripeAccountId: true,
    },
  });

  const completedProtectedSourcingCount = await prisma.protectedTransaction.count({
    where: {
      sellerId: user.id,
      stripeMode: "LIVE",
      status: "RELEASED",
      fundedAt: { not: null },
    },
  });

  // Sample statuses for diagnostics (no amounts / counterparties)
  const statusGroups = await prisma.protectedTransaction.groupBy({
    by: ["status", "stripeMode"],
    where: { sellerId: user.id },
    _count: { _all: true },
  });

  const passportVerified = isIdentityBadgeVisible(user);
  const livePayoutsEnabled = Boolean(liveConnect?.payoutsEnabled);
  const endorsementAvailable =
    !user.deletedAt &&
    !user.isDemo &&
    !user.isTestAccount &&
    !user.isAdmin &&
    (user.role || "").toUpperCase() !== "ADMIN";

  let tier = null;
  if (endorsementAvailable) {
    const silver = passportVerified && livePayoutsEnabled;
    if (silver && completedProtectedSourcingCount >= 1) tier = "GOLD";
    else if (silver) tier = "SILVER";
    else tier = "BRONZE";
  }

  // Privacy: do not print Connect IDs or txn IDs in the default report.
  const report = {
    ok: true,
    username: USERNAME,
    endorsementAvailable,
    passportVerified,
    liveConnectPresent: Boolean(liveConnect?.stripeAccountId),
    livePayoutsEnabled,
    detailsSubmitted: Boolean(liveConnect?.detailsSubmitted),
    completedProtectedSourcingCount,
    computedTier: tier,
    sellerStatusGroups: statusGroups.map((g) => ({
      stripeMode: g.stripeMode,
      status: g.status,
      count: g._count._all,
    })),
    note: "Universal resolver rules only — no username hard-coding in product runtime.",
  };

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
