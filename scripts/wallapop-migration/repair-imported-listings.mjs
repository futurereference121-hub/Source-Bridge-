/**
 * One-time repair for Wallapop imports owned by @theowlsaid.
 *
 * - Confirms exactly the Wallapop-sourced listings for the destination owner
 * - Verifies image relations (ListingImage rows + JSON images field)
 * - Sets saleStatus to AVAILABLE (standard active listing status)
 * - Normalizes productKind / empty clothing sizes if needed
 * - Does not touch other users' products
 * - Does not create duplicates
 *
 * Usage:
 *   node --env-file=.env.local --import=dotenv/config scripts/wallapop-migration/repair-imported-listings.mjs
 *   node --env-file=.env.local --import=dotenv/config scripts/wallapop-migration/repair-imported-listings.mjs --confirm
 *
 * Dry-run by default (no writes unless --confirm).
 */
import { PrismaClient } from "@prisma/client";

const DEST_USER_ID = "cms62cfan0000ih04giwg7ee3";
const DEST_USERNAME = "theowlsaid";
const EXPECTED_COUNT = 32;
const EXPECTED_IMAGES = 160;
const ACTIVE_STATUS = "AVAILABLE";

const args = new Set(process.argv.slice(2));
const CONFIRM = args.has("--confirm");
const DRY_RUN = !CONFIRM;

const prisma = new PrismaClient();

function parseAttributes(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function parseJsonArray(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x) => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

function isWallapopImport(attrs) {
  return (
    attrs.source === "wallapop" ||
    (typeof attrs.wallapopId === "string" && attrs.wallapopId.length > 0)
  );
}

async function main() {
  console.log("=== Wallapop imported listings repair ===");
  console.log(`Mode: ${DRY_RUN ? "DRY-RUN (pass --confirm to write)" : "CONFIRM (writes enabled)"}`);
  console.log(`Owner: @${DEST_USERNAME} (${DEST_USER_ID})`);
  console.log(`Target saleStatus: ${ACTIVE_STATUS}`);
  console.log("");

  const owner = await prisma.user.findUnique({
    where: { id: DEST_USER_ID },
    select: { id: true, username: true },
  });
  if (!owner) {
    throw new Error(`Owner not found: ${DEST_USER_ID}`);
  }
  if (owner.username !== DEST_USERNAME) {
    throw new Error(
      `Owner username mismatch: expected @${DEST_USERNAME}, got @${owner.username}`,
    );
  }

  const allOwned = await prisma.stockListing.findMany({
    where: { userId: DEST_USER_ID },
    include: {
      listingImages: { orderBy: { sortOrder: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });

  const imported = allOwned.filter((r) =>
    isWallapopImport(parseAttributes(r.attributes)),
  );

  console.log("--- Before ---");
  console.log(`Total listings owned by user: ${allOwned.length}`);
  console.log(`Wallapop-imported listings: ${imported.length} (expected ${EXPECTED_COUNT})`);

  const statusBefore = {};
  for (const r of imported) {
    const s = r.saleStatus || "(empty)";
    statusBefore[s] = (statusBefore[s] || 0) + 1;
  }
  console.log("Imported saleStatus counts:", statusBefore);

  let imageRows = 0;
  let jsonImageUrls = 0;
  let missingImages = 0;
  let emptyTitle = 0;
  let emptyDesc = 0;
  let emptyCategory = 0;
  let emptyLocation = 0;
  let clothingNoSizes = 0;
  const issues = [];

  for (const r of imported) {
    const attrs = parseAttributes(r.attributes);
    const jsonImgs = parseJsonArray(r.images);
    const relImgs = r.listingImages || [];
    imageRows += relImgs.length;
    jsonImageUrls += jsonImgs.length;

    if (!r.id) issues.push({ id: r.id, issue: "missing id" });
    if (r.userId !== DEST_USER_ID) {
      issues.push({ id: r.id, issue: "wrong owner" });
    }
    if (!r.name?.trim()) {
      emptyTitle += 1;
      issues.push({ id: r.id, issue: "empty title" });
    }
    if (!r.description?.trim()) {
      emptyDesc += 1;
      issues.push({ id: r.id, issue: "empty description" });
    }
    if (!r.category?.trim()) {
      emptyCategory += 1;
      issues.push({ id: r.id, issue: "empty category" });
    }
    if (!r.location?.trim() && !r.shipFromCity?.trim()) {
      emptyLocation += 1;
      issues.push({ id: r.id, issue: "empty location" });
    }
    if (!relImgs.length && !jsonImgs.length) {
      missingImages += 1;
      issues.push({ id: r.id, issue: "no images" });
    }
    if (relImgs.length && jsonImgs.length && relImgs.length !== jsonImgs.length) {
      issues.push({
        id: r.id,
        issue: `image count mismatch rel=${relImgs.length} json=${jsonImgs.length}`,
      });
    }
    const sizes = parseJsonArray(r.sizes);
    if (r.productKind === "clothing" && !sizes.length) {
      clothingNoSizes += 1;
    }
    if (!attrs.wallapopId) {
      issues.push({ id: r.id, issue: "missing wallapopId in attributes" });
    }
  }

  console.log(`ListingImage rows linked: ${imageRows} (expected ~${EXPECTED_IMAGES})`);
  console.log(`JSON images[] URLs total: ${jsonImageUrls}`);
  console.log(`Listings with no images: ${missingImages}`);
  console.log(`Empty title/desc/category/location: ${emptyTitle}/${emptyDesc}/${emptyCategory}/${emptyLocation}`);
  console.log(`Clothing with empty sizes: ${clothingNoSizes}`);
  if (issues.length) {
    console.log(`Issues found: ${issues.length}`);
    for (const i of issues.slice(0, 20)) {
      console.log(`  - ${i.id}: ${i.issue}`);
    }
    if (issues.length > 20) console.log(`  … +${issues.length - 20} more`);
  } else {
    console.log("Structural audit: OK");
  }

  if (imported.length !== EXPECTED_COUNT) {
    console.warn(
      `WARNING: expected ${EXPECTED_COUNT} imported products, found ${imported.length}`,
    );
  }

  const toActivate = imported.filter((r) => r.saleStatus !== ACTIVE_STATUS);
  const toFixSizes = imported.filter((r) => {
    if (r.productKind !== "clothing") return false;
    return !parseJsonArray(r.sizes).length;
  });

  console.log("");
  console.log("--- Planned repairs ---");
  console.log(`Set saleStatus → ${ACTIVE_STATUS}: ${toActivate.length}`);
  console.log(`Normalize empty clothing sizes → ["Multiple sizes available"]: ${toFixSizes.length}`);

  if (DRY_RUN) {
    console.log("");
    console.log("Dry-run complete. No writes performed.");
    console.log("Re-run with --confirm to apply.");
    return;
  }

  let updatedStatus = 0;
  let updatedSizes = 0;

  for (const r of toActivate) {
    await prisma.stockListing.update({
      where: { id: r.id },
      data: { saleStatus: ACTIVE_STATUS },
    });
    updatedStatus += 1;
  }

  for (const r of toFixSizes) {
    await prisma.stockListing.update({
      where: { id: r.id },
      data: { sizes: JSON.stringify(["Multiple sizes available"]) },
    });
    updatedSizes += 1;
  }

  const after = await prisma.stockListing.findMany({
    where: { userId: DEST_USER_ID },
    include: { listingImages: true },
  });
  const afterImported = after.filter((r) =>
    isWallapopImport(parseAttributes(r.attributes)),
  );
  const statusAfter = {};
  for (const r of afterImported) {
    const s = r.saleStatus || "(empty)";
    statusAfter[s] = (statusAfter[s] || 0) + 1;
  }
  const afterImages = afterImported.reduce(
    (n, r) => n + (r.listingImages?.length || 0),
    0,
  );

  console.log("");
  console.log("--- After ---");
  console.log(`Imported listings: ${afterImported.length}`);
  console.log("Imported saleStatus counts:", statusAfter);
  console.log(`ListingImage rows: ${afterImages}`);
  console.log(`Records updated (saleStatus): ${updatedStatus}`);
  console.log(`Records updated (sizes): ${updatedSizes}`);
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
