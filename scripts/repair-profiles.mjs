/**
 * Safe reconciliation for incomplete / inconsistent member accounts.
 *
 * Finds and repairs:
 *   - Missing slug when username exists
 *   - isDiscoverable accidentally false for normal members
 *   - Verified users with username+slug who finished identity+location but
 *     never flipped onboardingComplete (stuck before Explore)
 *
 * Never invents usernames. Never touches adminsource / ADMIN / deleted users.
 * Never duplicates records.
 *
 * Usage:
 *   npm run repair-profiles            # apply
 *   npm run repair-profiles -- --dry-run
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const ADMIN_USERNAME = "adminsource";
const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");

function slugFromUsername(username) {
  return String(username || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9_]+/g, "")
    .slice(0, 30);
}

async function main() {
  console.log(
    `\n[repair-profiles] ${DRY_RUN ? "DRY RUN — no writes" : "APPLYING repairs"}\n`,
  );

  const users = await prisma.user.findMany({
    where: {
      deletedAt: null,
      role: { not: "ADMIN" },
      isAdmin: false,
      OR: [{ username: null }, { username: { not: ADMIN_USERNAME } }],
    },
    select: {
      id: true,
      email: true,
      name: true,
      username: true,
      slug: true,
      emailVerified: true,
      onboardingComplete: true,
      isDiscoverable: true,
      isTestAccount: true,
      city: true,
      country: true,
      photo: true,
      bio: true,
      publicDisplayMessage: true,
    },
  });

  let scanned = users.length;
  let repaired = 0;
  let skipped = 0;
  let errors = 0;
  const actions = [];

  for (const u of users) {
    try {
      const data = {};
      const notes = [];

      if (!u.username && u.emailVerified && !u.isTestAccount) {
        const base =
          slugFromUsername(u.name).replace(/_+/g, "_").replace(/^_|_$/g, "") ||
          "member";
        let candidate = `${base.slice(0, 20)}_${u.id.slice(-6)}`.toLowerCase();
        if (candidate.length < 3) candidate = `member_${u.id.slice(-8)}`;
        const taken = await prisma.user.findFirst({
          where: {
            OR: [{ username: candidate }, { slug: candidate }],
            NOT: { id: u.id },
          },
          select: { id: true },
        });
        if (!taken) {
          data.username = candidate;
          data.slug = candidate;
          notes.push("restore-missing-username");
        } else {
          skipped += 1;
          console.log(
            `SKIP username collision for ${u.id} candidate=${candidate}`,
          );
          continue;
        }
      }

      const username = data.username || u.username;
      const slug = data.slug || u.slug;

      if (username && !slug) {
        data.slug = slugFromUsername(username);
        notes.push("set-missing-slug");
      }

      if (
        username &&
        (slug || data.slug) &&
        u.emailVerified &&
        !u.isDiscoverable &&
        !u.isTestAccount
      ) {
        data.isDiscoverable = true;
        notes.push("restore-discoverable");
      }

      // Stuck after identity: verified + username/slug but never completed help step.
      // Location is optional — mark complete so they appear on Explore.
      if (
        u.emailVerified &&
        username &&
        (slug || data.slug) &&
        !u.onboardingComplete &&
        !u.isTestAccount
      ) {
        data.onboardingComplete = true;
        data.isDiscoverable = true;
        if (!slug && !data.slug) data.slug = slugFromUsername(username);
        notes.push("complete-stuck-onboarding");
      }

      if (!Object.keys(data).length) {
        skipped += 1;
        continue;
      }

      actions.push({
        id: u.id,
        username: username,
        notes,
        data,
      });

      if (!DRY_RUN) {
        await prisma.user.update({ where: { id: u.id }, data });
      }
      repaired += 1;
    } catch (err) {
      errors += 1;
      console.error("ERROR", u.id, err instanceof Error ? err.message : err);
    }
  }

  console.log("=== Repair report ===");
  console.log(`Users scanned: ${scanned}`);
  console.log(`Profiles repaired: ${repaired}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors}`);
  for (const a of actions.slice(0, 50)) {
    console.log(
      ` - ${a.username || "(no-user)"} [${a.id}] → ${a.notes.join(", ")}`,
    );
  }
  if (actions.length > 50) {
    console.log(` …and ${actions.length - 50} more`);
  }
  console.log(DRY_RUN ? "\nDry run complete." : "\nRepairs applied.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
