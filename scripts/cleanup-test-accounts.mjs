/**
 * Remove messaging test fixtures (messenger_a/b/c, etc.) from public
 * discovery and, by default, soft-delete them so Explore/search/feeds never
 * surface them. Never touches the adminsource account except to enforce its
 * admin/non-discoverable flags.
 *
 * Usage:
 *   npm run cleanup-test-accounts            # soft-delete (default, safe)
 *   npm run cleanup-test-accounts -- --hard  # hard-delete matched rows
 *   npm run cleanup-test-accounts -- --dry-run
 *
 * Prints a report of what changed (ids/usernames/action only — no passwords
 * or other secrets).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ADMIN_USERNAME = "adminsource";
const TEST_USERNAMES = ["messenger_a", "messenger_b", "messenger_c"];

const args = new Set(process.argv.slice(2));
const HARD_DELETE = args.has("--hard");
const DRY_RUN = args.has("--dry-run");

async function findTestAccounts() {
  const candidates = await prisma.user.findMany({
    where: {
      OR: [
        { username: { in: TEST_USERNAMES } },
        { isTestAccount: true },
        { email: { startsWith: "messenger-", endsWith: "@sourcebridge.test" } },
      ],
    },
    select: {
      id: true,
      email: true,
      username: true,
      slug: true,
      isTestAccount: true,
      isDiscoverable: true,
      deletedAt: true,
      role: true,
      isAdmin: true,
    },
  });
  // Never touch the real admin account, no matter what else matches.
  return candidates.filter(
    (u) => u.username?.toLowerCase() !== ADMIN_USERNAME,
  );
}

function anonymizedEmail(id) {
  return `deleted+${id}@invalid.local`;
}

function deletedHandle(handle, id) {
  return `${handle}__deleted__${id}`;
}

async function softDelete(user) {
  const now = new Date();
  const data = {
    isTestAccount: true,
    isDiscoverable: false,
    deletedAt: now,
    email: anonymizedEmail(user.id),
    ...(user.username
      ? { username: deletedHandle(user.username, user.id) }
      : {}),
    ...(user.slug ? { slug: deletedHandle(user.slug, user.id) } : {}),
  };
  if (!DRY_RUN) {
    await prisma.$transaction([
      prisma.session.deleteMany({ where: { userId: user.id } }),
      prisma.user.update({ where: { id: user.id }, data }),
    ]);
  }
  return { id: user.id, usernameBefore: user.username, action: "soft-deleted" };
}

async function hardDelete(user) {
  if (!DRY_RUN) {
    // Sessions and most owned rows cascade via onDelete: Cascade in the
    // Prisma schema (Session, Conversation participants, sourcing requests,
    // transactions, listings, statuses, opportunities, etc.).
    await prisma.user.delete({ where: { id: user.id } });
  }
  return { id: user.id, usernameBefore: user.username, action: "hard-deleted" };
}

async function ensureAdminLocked() {
  const admin = await prisma.user.findFirst({
    where: { username: ADMIN_USERNAME },
    select: { id: true, username: true, role: true, isAdmin: true, isDiscoverable: true },
  });
  if (!admin) {
    console.log(`\nNote: no "${ADMIN_USERNAME}" account found — nothing to lock.`);
    return null;
  }
  const needsUpdate =
    admin.isDiscoverable !== false || admin.role !== "ADMIN" || admin.isAdmin !== true;
  if (needsUpdate && !DRY_RUN) {
    await prisma.user.update({
      where: { id: admin.id },
      data: { isDiscoverable: false, role: "ADMIN", isAdmin: true },
    });
  }
  return { id: admin.id, username: admin.username, updated: needsUpdate };
}

try {
  const targets = await findTestAccounts();
  console.log(
    `Found ${targets.length} test/messaging account(s) to clean up${DRY_RUN ? " (dry run)" : ""}.`,
  );

  const results = [];
  for (const user of targets) {
    const result = HARD_DELETE ? await hardDelete(user) : await softDelete(user);
    results.push(result);
  }

  const adminResult = await ensureAdminLocked();

  console.log("\n=== Cleanup report ===");
  if (!results.length) {
    console.log("No matching test accounts found.");
  } else {
    for (const r of results) {
      console.log(`- ${r.action.padEnd(14)} id=${r.id} username=${r.usernameBefore ?? "(none)"}`);
    }
  }
  if (adminResult) {
    console.log(
      `- admin locked   id=${adminResult.id} username=${adminResult.username} ` +
        `(${adminResult.updated ? "updated" : "already compliant"}: isDiscoverable=false, role=ADMIN)`,
    );
  }
  console.log(`\nTotal changed: ${results.length}${DRY_RUN ? " (dry run — no writes made)" : ""}`);
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
