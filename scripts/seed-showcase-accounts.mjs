/**
 * Idempotent showcase demo accounts for Source Bridge Explore.
 *
 * Dry-run by default — pass --confirm to write.
 *
 * Usage:
 *   npm run seed:showcase
 *   npm run seed:showcase -- --confirm
 *   npm run refine:showcase -- --confirm
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";
import {
  SHOWCASE_ACCOUNTS,
  SHOWCASE_USERNAMES,
  LEGACY_SHOWCASE_USERNAMES,
} from "./lib/showcase-accounts-data.mjs";

const prisma = new PrismaClient();

const args = new Set(process.argv.slice(2));
const DRY_RUN = !args.has("--confirm");

const DEMO_PASSWORD = "Showcase!Demo2026";
const SHOWCASE_ATTRS = { source: "showcase", isDemo: true };
const STATUS_TTL_MS = 24 * 60 * 60 * 1000;

function hashPassword(plain) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(plain, salt, 64);
  return `${salt}:${derived.toString("hex")}`;
}

function cleanListingSlug(raw) {
  return String(raw || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function listingSlugFor(username, productKey) {
  return cleanListingSlug(`showcase-${username}-${productKey}`);
}

function showcaseEmail(username) {
  return `showcase+${username.replace(/\./g, "-")}@sourcebridge.demo`;
}

function attrsJson(productKey) {
  return JSON.stringify({ ...SHOWCASE_ATTRS, showcaseKey: productKey });
}

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function showcaseUserWhere() {
  const usernames = [...SHOWCASE_USERNAMES, ...LEGACY_SHOWCASE_USERNAMES];
  return {
    isDemo: true,
    OR: [
      { username: { in: usernames } },
      { email: { endsWith: "@sourcebridge.demo" } },
    ],
  };
}

async function countShowcaseEntities(userIds) {
  if (!userIds.length) {
    return {
      users: 0,
      listings: 0,
      listingImages: 0,
      statuses: 0,
      opportunities: 0,
      networkLocations: 0,
    };
  }
  const [listings, listingImages, statuses, opportunities, networkLocations] =
    await Promise.all([
      prisma.stockListing.count({ where: { userId: { in: userIds } } }),
      prisma.listingImage.count({
        where: { listing: { userId: { in: userIds } } },
      }),
      prisma.statusUpdate.count({ where: { userId: { in: userIds } } }),
      prisma.opportunity.count({ where: { userId: { in: userIds } } }),
      prisma.networkLocation.count({ where: { userId: { in: userIds } } }),
    ]);
  return {
    users: userIds.length,
    listings,
    listingImages,
    statuses,
    opportunities,
    networkLocations,
  };
}

function printCounts(label, counts) {
  console.log(
    `${label}: users=${counts.users} listings=${counts.listings} images=${counts.listingImages} statuses=${counts.statuses} opportunities=${counts.opportunities} network=${counts.networkLocations}`,
  );
}

async function findExistingShowcase(account) {
  const candidates = [
    account.username,
    ...(account.previousUsernames || []),
  ];
  for (const username of candidates) {
    const byUsername = await prisma.user.findUnique({ where: { username } });
    if (byUsername) return byUsername;
  }
  for (const username of candidates) {
    const byEmail = await prisma.user.findUnique({
      where: { email: showcaseEmail(username) },
    });
    if (byEmail) return byEmail;
    // Legacy emails used dots in the local part before this refine.
    const legacyEmail = `showcase+${username}@sourcebridge.demo`;
    if (legacyEmail !== showcaseEmail(username)) {
      const byLegacy = await prisma.user.findUnique({
        where: { email: legacyEmail },
      });
      if (byLegacy) return byLegacy;
    }
  }
  return null;
}

async function upsertShowcaseUser(account, passwordHash) {
  const email = showcaseEmail(account.username);
  const userData = {
    email,
    name: account.name,
    username: account.username,
    slug: account.username,
    photo: account.photo,
    cover: account.cover,
    bio: account.bio,
    publicDisplayMessage: account.publicDisplayMessage,
    city: account.city,
    country: account.country,
    memberType: account.memberType,
    intent: "both",
    specialties: JSON.stringify(account.specialties),
    emailVerified: true,
    onboardingComplete: true,
    identityVerified: false,
    identityVerificationStatus: "UNVERIFIED",
    isDiscoverable: true,
    isTestAccount: false,
    isDemo: true,
    isAdmin: false,
    role: "USER",
    passwordHash,
    mustChangePassword: false,
    profileVideoUrl: "",
    profileVideoPosterUrl: "",
    profileVideoPathname: "",
    profileVideoPosterPathname: "",
    profileVideoMime: "",
    profileVideoDurationSec: null,
    profileVideoCaption: "",
    profileVideoUpdatedAt: null,
  };

  const existing = await findExistingShowcase(account);

  if (existing) {
    if (!existing.isDemo && !existing.email.endsWith("@sourcebridge.demo")) {
      throw new Error(
        `Refusing to update non-demo user @${existing.username} (${existing.email})`,
      );
    }
    // Clear any pending identity verification for demo accounts.
    await prisma.identityVerificationRequest.deleteMany({
      where: { userId: existing.id },
    });
    return prisma.user.update({
      where: { id: existing.id },
      data: userData,
    });
  }

  return prisma.user.create({ data: userData });
}

async function syncNetworkLocations(userId, cities) {
  await prisma.networkLocation.deleteMany({ where: { userId } });
  for (const [sortOrder, loc] of cities.entries()) {
    await prisma.networkLocation.create({
      data: {
        userId,
        city: loc.city,
        country: loc.country,
        sortOrder,
      },
    });
  }
}

async function findShowcaseListing(userId, account, product) {
  const slug = listingSlugFor(account.username, product.key);
  const bySlug = await prisma.stockListing.findUnique({ where: { slug } });
  if (bySlug?.userId === userId) return bySlug;

  const rows = await prisma.stockListing.findMany({
    where: { userId },
    select: {
      id: true,
      slug: true,
      name: true,
      attributes: true,
      userId: true,
    },
  });

  return (
    rows.find((row) => {
      try {
        const attrs = JSON.parse(row.attributes || "{}");
        return attrs.source === "showcase" && attrs.showcaseKey === product.key;
      } catch {
        return false;
      }
    }) ?? null
  );
}

async function upsertListing(userId, account, product) {
  const slug = listingSlugFor(account.username, product.key);
  const images = [...new Set((product.images || []).filter(Boolean))];
  const shipLabel = `${account.city}, ${account.country}`;
  const listingData = {
    name: product.name,
    slug,
    description: product.description,
    productKind: product.productKind,
    category: product.category,
    subcategory: product.subcategory || "",
    images: JSON.stringify(images),
    sizes: JSON.stringify(product.sizes || []),
    quantity: product.productKind === "general" ? "Available" : "",
    material: product.material || "",
    availability: "available",
    saleStatus: "AVAILABLE",
    location: shipLabel,
    shipFromCity: account.city,
    shipFromCountry: account.country,
    shippingAvailable: true,
    price: product.price,
    currency: "USD",
    attributes: attrsJson(product.key),
  };

  const existing = await findShowcaseListing(userId, account, product);

  if (existing) {
    await prisma.$transaction(async (tx) => {
      await tx.stockListing.update({
        where: { id: existing.id },
        data: { ...listingData, userId },
      });
      await tx.listingImage.deleteMany({ where: { listingId: existing.id } });
      for (const [sortOrder, url] of images.entries()) {
        await tx.listingImage.create({
          data: {
            listingId: existing.id,
            url,
            sortOrder,
            isCover: sortOrder === 0,
          },
        });
      }
    });
    return { action: "updated", slug };
  }

  const created = await prisma.$transaction(async (tx) => {
    return tx.stockListing.create({
      data: {
        userId,
        ...listingData,
        listingImages: {
          create: images.map((url, sortOrder) => ({
            url,
            sortOrder,
            isCover: sortOrder === 0,
          })),
        },
      },
    });
  });
  return { action: "created", slug: created.slug };
}

async function pruneExtraListings(userId, keepKeys) {
  const rows = await prisma.stockListing.findMany({
    where: { userId },
    select: { id: true, attributes: true },
  });
  for (const row of rows) {
    try {
      const attrs = JSON.parse(row.attributes || "{}");
      if (attrs.source === "showcase" && !keepKeys.has(attrs.showcaseKey)) {
        await prisma.listingImage.deleteMany({ where: { listingId: row.id } });
        await prisma.stockListing.delete({ where: { id: row.id } });
      }
    } catch {
      /* ignore */
    }
  }
}

async function refreshStatus(userId, text) {
  const now = new Date();
  await prisma.statusUpdate.deleteMany({ where: { userId } });
  await prisma.statusUpdate.create({
    data: {
      userId,
      text,
      postedAt: now,
      expiresAt: new Date(now.getTime() + STATUS_TTL_MS),
    },
  });
}

async function refreshOpportunities(userId, opportunities) {
  await prisma.opportunity.deleteMany({ where: { userId } });
  const now = new Date();
  for (const [index, opp] of opportunities.entries()) {
    await prisma.opportunity.create({
      data: {
        userId,
        title: opp.title,
        description: opp.description,
        city: opp.city,
        country: opp.country,
        category: opp.category,
        postedAt: new Date(now.getTime() - index * 60_000),
        expiresAt: daysFromNow(30),
        startsAt: hoursFromNow(24 + index * 12),
        closedAt: null,
      },
    });
  }
  return opportunities.length;
}

async function seedAccount(account, passwordHash) {
  const user = await upsertShowcaseUser(account, passwordHash);
  await syncNetworkLocations(user.id, account.networkCities);

  const listingResults = [];
  for (const product of account.products) {
    listingResults.push(await upsertListing(user.id, account, product));
  }
  await pruneExtraListings(
    user.id,
    new Set(account.products.map((p) => p.key)),
  );

  await refreshStatus(user.id, account.statusText);
  const oppCount = await refreshOpportunities(
    user.id,
    account.opportunities ||
      (account.opportunity ? [account.opportunity] : []),
  );

  return {
    username: account.username,
    previous: account.previousUsernames || [],
    userId: user.id,
    city: account.city,
    country: account.country,
    products: account.products.length,
    listings: listingResults,
    opportunities: oppCount,
  };
}

async function main() {
  console.log(
    DRY_RUN
      ? "DRY RUN — no database writes. Pass --confirm to apply.\n"
      : "LIVE RUN — writing showcase accounts…\n",
  );

  const beforeUsers = await prisma.user.findMany({
    where: showcaseUserWhere(),
    select: { id: true, username: true },
  });
  const beforeIds = beforeUsers.map((u) => u.id);
  const beforeCounts = await countShowcaseEntities(beforeIds);
  printCounts("Before", beforeCounts);
  if (beforeUsers.length) {
    console.log(
      "Existing demo usernames:",
      beforeUsers.map((u) => `@${u.username}`).join(", "),
    );
  }

  if (DRY_RUN) {
    console.log("\nWould upsert showcase accounts:");
    for (const account of SHOWCASE_ACCOUNTS) {
      const rename =
        account.previousUsernames?.length
          ? ` (from ${account.previousUsernames.map((u) => `@${u}`).join(", ")})`
          : "";
      console.log(
        `  @${account.username}${rename} — ${account.city}, ${account.country} · ${account.products.length} products · 1 status · ${(account.opportunities || []).length} opportunities`,
      );
    }
    console.log(`\nDemo login password (when --confirm): ${DEMO_PASSWORD}`);
    console.log("Re-run with: npm run seed:showcase -- --confirm");
    return;
  }

  const passwordHash = hashPassword(DEMO_PASSWORD);
  const results = [];

  for (const account of SHOWCASE_ACCOUNTS) {
    const result = await seedAccount(account, passwordHash);
    results.push(result);
    console.log(
      `OK @${result.username} — ${result.products} products · ${result.opportunities} opportunities`,
    );
  }

  const afterUsers = await prisma.user.findMany({
    where: showcaseUserWhere(),
    select: { id: true, username: true },
  });
  const afterCounts = await countShowcaseEntities(afterUsers.map((u) => u.id));
  console.log("");
  printCounts("After", afterCounts);

  console.log("\nShowcase accounts summary:");
  for (const r of results) {
    console.log(
      `  @${r.username} · ${r.city}, ${r.country} · ${r.products} products · ${r.opportunities} opportunities`,
    );
  }
  console.log(`\nDemo sign-in password: ${DEMO_PASSWORD}`);
  console.log("(isDemo accounts — messaging/verification/payments blocked.)");
}

try {
  await main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
