/**
 * Import Wallapop export into Source Bridge account @theowlsaid only.
 *
 * - Dry-run by default (--dry-run) or with no --confirm
 * - Real import requires --confirm
 * - Uses existing StockListing model; saleStatus=ARCHIVED (no Draft model exists)
 * - Dedupes by attributes.wallapopId
 * - Uploads images via @vercel/blob into stock/{userId}/…
 *
 * Usage:
 *   npm run wallapop:import -- --dry-run
 *   npm run wallapop:import -- --confirm
 */
import { PrismaClient } from "@prisma/client";
import { put, del } from "@vercel/blob";
import { randomBytes } from "crypto";
import { readFile, access } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import {
  mapWallapopCategory,
  mapCondition,
} from "./lib/category-map.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const OUT_DIR = path.join(ROOT, "data", "wallapop-export");
const LISTINGS_PATH = path.join(OUT_DIR, "listings.json");
const DEST_USERNAME = "theowlsaid";

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run") || !args.has("--confirm");
const CONFIRM = args.has("--confirm");

const prisma = new PrismaClient();

function cleanListingSlug(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function buildListingSlug(name, existing = []) {
  const base = cleanListingSlug(name) || "item";
  if (!existing.includes(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!existing.includes(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36).slice(-6)}`;
}

function extensionFor(contentType, fallback = "jpg") {
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("webp")) return "webp";
  if (contentType?.includes("jpeg") || contentType?.includes("jpg")) return "jpg";
  return fallback;
}

async function uploadLocalImage(userId, absolutePath) {
  const buf = await readFile(absolutePath);
  const ext = path.extname(absolutePath).replace(".", "") || "jpg";
  const contentType =
    ext === "png"
      ? "image/png"
      : ext === "webp"
        ? "image/webp"
        : "image/jpeg";
  const pathname = `stock/${userId}/${Date.now()}-${randomBytes(6).toString("hex")}.${extensionFor(contentType, ext)}`;

  // Match src/lib/storage.ts: public Blob works with BLOB_READ_WRITE_TOKEN
  // OR BLOB_STORE_ID + VERCEL_OIDC_TOKEN (no static rw token required).
  const token = process.env.BLOB_READ_WRITE_TOKEN || undefined;
  if (!process.env.BLOB_STORE_ID && !token) {
    throw new Error(
      "Vercel Blob is not configured (need BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID).",
    );
  }

  const blob = await put(pathname, buf, {
    access: "public",
    contentType,
    addRandomSuffix: false,
    ...(token ? { token } : {}),
  });
  return blob.url;
}

async function deleteUploadedBlobs(urls) {
  if (!urls?.length) return;
  const token = process.env.BLOB_READ_WRITE_TOKEN || undefined;
  try {
    await del(urls, token ? { token } : undefined);
  } catch (err) {
    console.error(
      "Failed to delete orphan Blob upload(s):",
      err instanceof Error ? err.message : err,
    );
  }
}

function parseAttributes(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

async function findExistingByWallapopId(userId, wallapopId) {
  const rows = await prisma.stockListing.findMany({
    where: { userId },
    select: { id: true, attributes: true, name: true, slug: true },
  });
  return rows.find((r) => parseAttributes(r.attributes).wallapopId === wallapopId);
}

async function main() {
  console.log(
    `\n=== Wallapop → Source Bridge import (${DRY_RUN ? "DRY RUN" : "LIVE IMPORT"}) ===\n`,
  );

  if (CONFIRM && DRY_RUN) {
    // --confirm without removing dry-run set: prefer confirm
  }
  const live = CONFIRM && !args.has("--dry-run");

  try {
    await access(LISTINGS_PATH);
  } catch {
    console.error(`Missing export file: ${LISTINGS_PATH}`);
    console.error("Export via the Edge extension, then: npm run wallapop:ingest");
    process.exit(1);
  }

  const EXPECTED_DISPLAY_NAME = "Dominic kidd";

  const dest = await prisma.user.findFirst({
    where: { username: DEST_USERNAME, deletedAt: null },
    select: {
      id: true,
      username: true,
      name: true,
      city: true,
      country: true,
      emailVerified: true,
      onboardingComplete: true,
    },
  });

  if (!dest) {
    console.error(`Destination account @${DEST_USERNAME} not found. Aborting.`);
    process.exit(1);
  }
  if (dest.username !== DEST_USERNAME) {
    console.error(`ABORT: username mismatch (got @${dest.username}).`);
    process.exit(1);
  }
  if (dest.name !== EXPECTED_DISPLAY_NAME) {
    console.error(
      `ABORT: display name mismatch (expected "${EXPECTED_DISPLAY_NAME}", got "${dest.name}").`,
    );
    process.exit(1);
  }
  const EXPECTED_USER_ID = "cms62cfan0000ih04giwg7ee3";
  if (dest.id !== EXPECTED_USER_ID) {
    console.error(
      `ABORT: internal user ID mismatch (expected ${EXPECTED_USER_ID}, got ${dest.id}).`,
    );
    process.exit(1);
  }
  if (!dest.emailVerified || !dest.onboardingComplete) {
    console.error(
      `@${DEST_USERNAME} is not fully verified/onboarded. Aborting.`,
    );
    process.exit(1);
  }

  const productsOwnedBefore = await prisma.stockListing.count({
    where: { userId: dest.id },
  });

  console.log("=== DESTINATION ACCOUNT (pre-import) ===");
  console.log(`Username: @${dest.username}`);
  console.log(`Display name: ${dest.name}`);
  console.log(`Internal user ID: ${dest.id}`);
  console.log(`Products currently owned: ${productsOwnedBefore}`);
  console.log("========================================\n");

  const raw = JSON.parse(await readFile(LISTINGS_PATH, "utf8"));
  const products = Array.isArray(raw) ? raw.filter((p) => !p.error) : [];

  const mapped = [];
  const review = [];
  let imagesFound = 0;

  for (const p of products) {
    imagesFound += p.localImages?.length || 0;
    const cat = mapWallapopCategory(p);
    if (!cat.ok) {
      review.push({ wallapopId: p.wallapopId, title: p.title, reason: cat.reason });
      continue;
    }
    if (!p.title || p.price == null || Number.isNaN(p.price)) {
      review.push({
        wallapopId: p.wallapopId,
        title: p.title,
        reason: "Missing title or price",
      });
      continue;
    }
    if (!p.localImages?.length) {
      review.push({
        wallapopId: p.wallapopId,
        title: p.title,
        reason: "No downloaded images",
      });
      continue;
    }
    mapped.push({ product: p, mapping: cat });
  }

  const categorySummary = {};
  for (const m of mapped) {
    const key = `${m.mapping.productKind} / ${m.mapping.category}${m.mapping.subcategory ? ` / ${m.mapping.subcategory}` : ""}`;
    categorySummary[key] = (categorySummary[key] || 0) + 1;
  }

  const duplicates = [];
  for (const { product: p } of mapped) {
    const existing = await findExistingByWallapopId(dest.id, p.wallapopId);
    if (existing) {
      duplicates.push({
        wallapopId: p.wallapopId,
        title: p.title,
        existingSlug: existing.slug,
        existingId: existing.id,
      });
    }
  }

  console.log("Destination account:", `@${dest.username} (${dest.name}) id=${dest.id}`);
  console.log("Products found (export OK):", products.length);
  console.log("Images found (downloaded):", imagesFound);
  console.log("Ready to import:", mapped.length);
  console.log("Needs review (skipped):", review.length);
  console.log("Existing duplicates (wallapopId already on account):", duplicates.length);
  console.log("Category summary:", categorySummary);

  console.log("\nProposed products:");
  for (const { product: p, mapping } of mapped) {
    const dup = duplicates.find((d) => d.wallapopId === p.wallapopId);
    console.log(
      ` - ${p.wallapopId} | ${p.title} | ${p.price} ${p.currency || "EUR"} | ${mapping.productKind}/${mapping.category}${mapping.subcategory ? "/" + mapping.subcategory : ""} | images=${p.localImages?.length || 0}${dup ? ` | DUPLICATE→${dup.existingSlug}` : ""}`,
    );
  }

  if (review.length) {
    console.log("\nReview / skipped:");
    for (const r of review.slice(0, 30)) {
      console.log(` - ${r.wallapopId} | ${r.title} | ${r.reason}`);
    }
  }

  if (duplicates.length) {
    console.log("\nDuplicate findings (would UPDATE on live import):");
    for (const d of duplicates) {
      console.log(` - ${d.wallapopId} | ${d.title} → existing ${d.existingSlug}`);
    }
  }

  console.log("\nNOTE: Source Bridge has no Draft/Hidden product state.");
  console.log(
    "ARCHIVED is the closest existing non-purchasable status.",
  );
  console.log(
    "Do not import as AVAILABLE until you approve using ARCHIVED (or choose another approach).",
  );
  console.log(
    "Owner profile stock lists may still show ARCHIVED items until you publish them manually.",
  );

  if (review.length && live) {
    console.error(
      `\nABORT: ${review.length} listing(s) still need category review. Refusing live import until all 32 map cleanly.`,
    );
    for (const r of review) {
      console.error(` - ${r.wallapopId} | ${r.title} | ${r.reason}`);
    }
    process.exit(1);
  }

  if (!live) {
    console.log("\nDry run only — no database writes.");
    console.log("Waiting for your approval before any production import.");
    console.log("To import for real later: npm run wallapop:import -- --confirm");
    return;
  }

  if (mapped.length !== products.length) {
    console.error(
      `ABORT: mapped ${mapped.length} != exported ${products.length}. Refusing partial import.`,
    );
    process.exit(1);
  }

  console.log("\nLIVE IMPORT starting into @theowlsaid only…");
  console.log(`Will create/update ${mapped.length} listings with all images (no 6-image cap).\n`);

  const existingSlugs = (
    await prisma.stockListing.findMany({ select: { slug: true } })
  ).map((r) => r.slug);

  let imported = 0;
  let updated = 0;
  let skippedDuplicates = 0;
  let failed = 0;
  let imagesUploaded = 0;
  const failures = [];
  const orphanUploads = [];
  const importedRows = [];

  const shipCity = dest.city || "Phuket";
  const shipCountry = dest.country || "Thailand";

  for (const { product: p, mapping } of mapped) {
    const imageUrls = [];
    try {
      // Re-check destination has not changed mid-run.
      if (dest.username !== DEST_USERNAME || dest.name !== EXPECTED_DISPLAY_NAME) {
        throw new Error("Destination account changed mid-import — aborting record");
      }

      const existing = await findExistingByWallapopId(dest.id, p.wallapopId);

      for (const img of p.localImages) {
        const abs = path.isAbsolute(img.localPath || "")
          ? img.localPath
          : path.join(
              OUT_DIR,
              img.localPath || path.join("images", img.filename),
            );
        const url = await uploadLocalImage(dest.id, abs);
        imageUrls.push(url);
      }
      if (!imageUrls.length) {
        throw new Error("Image upload produced no URLs");
      }
      if (imageUrls.length !== p.localImages.length) {
        throw new Error(
          `Image count mismatch: uploaded ${imageUrls.length} vs local ${p.localImages.length}`,
        );
      }

      const attrs = {
        source: "wallapop",
        wallapopId: p.wallapopId,
        wallapopUrl: p.listingUrl,
        importedAt: new Date().toISOString(),
        originalCategory: p.category || "",
        originalSubcategory: p.subcategory || "",
      };

      const data = {
        name: String(p.title).slice(0, 120),
        description: String(p.description || p.title).slice(0, 4000),
        productKind: mapping.productKind,
        category: mapping.category,
        subcategory: mapping.subcategory || "",
        images: JSON.stringify(imageUrls),
        sizes:
          mapping.productKind === "clothing"
            ? JSON.stringify(["Multiple sizes available"])
            : "[]",
        condition: mapCondition(p.condition),
        saleStatus: "ARCHIVED",
        availability: "available",
        location: p.location || `${shipCity}, ${shipCountry}`,
        shipFromCity: shipCity,
        shipFromCountry: shipCountry,
        shippingAvailable: false,
        price: Number(p.price),
        currency: p.currency || "EUR",
        attributes: JSON.stringify(attrs),
        userId: dest.id,
      };

      let listingId;
      let slug;
      let action;

      if (existing) {
        // Duplicate key hit: update in place (no second product).
        skippedDuplicates += 1;
        await prisma.$transaction(async (tx) => {
          await tx.stockListing.update({
            where: { id: existing.id },
            data: {
              name: data.name,
              description: data.description,
              productKind: data.productKind,
              category: data.category,
              subcategory: data.subcategory,
              images: data.images,
              sizes: data.sizes,
              condition: data.condition,
              saleStatus: "ARCHIVED",
              availability: data.availability,
              location: data.location,
              shipFromCity: data.shipFromCity,
              shipFromCountry: data.shipFromCountry,
              shippingAvailable: data.shippingAvailable,
              price: data.price,
              currency: data.currency,
              attributes: data.attributes,
              userId: dest.id,
            },
          });
          await tx.listingImage.deleteMany({ where: { listingId: existing.id } });
          for (const [sortOrder, url] of imageUrls.entries()) {
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
        listingId = existing.id;
        slug = existing.slug;
        action = "UPDATED";
        updated += 1;
      } else {
        const newSlug = buildListingSlug(p.title, existingSlugs);
        existingSlugs.push(newSlug);
        const created = await prisma.$transaction(async (tx) => {
          return tx.stockListing.create({
            data: {
              userId: dest.id,
              slug: newSlug,
              name: data.name,
              description: data.description,
              productKind: data.productKind,
              category: data.category,
              subcategory: data.subcategory,
              images: data.images,
              sizes: data.sizes,
              condition: data.condition,
              saleStatus: "ARCHIVED",
              availability: data.availability,
              location: data.location,
              shipFromCity: data.shipFromCity,
              shipFromCountry: data.shipFromCountry,
              shippingAvailable: data.shippingAvailable,
              price: data.price,
              currency: data.currency,
              attributes: data.attributes,
              listingImages: {
                create: imageUrls.map((url, sortOrder) => ({
                  url,
                  sortOrder,
                  isCover: sortOrder === 0,
                })),
              },
            },
          });
        });
        listingId = created.id;
        slug = created.slug;
        action = "CREATED";
        imported += 1;
      }

      imagesUploaded += imageUrls.length;
      importedRows.push({
        wallapopId: p.wallapopId,
        listingId,
        slug,
        action,
        title: p.title,
        price: p.price,
        currency: p.currency || "EUR",
        category: `${mapping.productKind}/${mapping.category}${mapping.subcategory ? "/" + mapping.subcategory : ""}`,
        imageCount: imageUrls.length,
        saleStatus: "ARCHIVED",
        userId: dest.id,
      });
      console.log(
        `${action} ${p.wallapopId} → ${slug} | images=${imageUrls.length} | ARCHIVED | owner=@${DEST_USERNAME}`,
      );
    } catch (err) {
      failed += 1;
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ wallapopId: p.wallapopId, title: p.title, error: msg });
      if (imageUrls.length) {
        console.error(
          `Rolling back ${imageUrls.length} Blob upload(s) for ${p.wallapopId}…`,
        );
        await deleteUploadedBlobs(imageUrls);
        orphanUploads.push({
          wallapopId: p.wallapopId,
          title: p.title,
          urlsCount: imageUrls.length,
          note: "Blob uploads deleted after DB failure (URLs not retained)",
        });
      }
      console.error(`FAILED ${p.wallapopId}: ${msg}`);
      // Stop this record only; continue remaining listings.
    }
  }

  // === Post-import verification ===
  const wallapopOwned = await prisma.stockListing.findMany({
    where: {
      userId: dest.id,
      attributes: { contains: '"source":"wallapop"' },
    },
    include: {
      listingImages: { orderBy: { sortOrder: "asc" } },
      user: { select: { id: true, username: true, name: true } },
    },
  });

  const wrongOwner = wallapopOwned.filter(
    (r) => r.userId !== dest.id || r.user.username !== DEST_USERNAME,
  );
  const notArchived = wallapopOwned.filter((r) => r.saleStatus !== "ARCHIVED");
  const availableStatus = wallapopOwned.filter(
    (r) => r.saleStatus === "AVAILABLE",
  );

  let dbImageRows = 0;
  let missingImageRows = 0;
  const imageOrderIssues = [];
  for (const row of wallapopOwned) {
    dbImageRows += row.listingImages.length;
    const cached = (() => {
      try {
        return JSON.parse(row.images || "[]");
      } catch {
        return [];
      }
    })();
    if (row.listingImages.length === 0) missingImageRows += 1;
    for (let i = 0; i < row.listingImages.length; i++) {
      const img = row.listingImages[i];
      if (img.sortOrder !== i) {
        imageOrderIssues.push({
          slug: row.slug,
          expected: i,
          got: img.sortOrder,
        });
      }
      if (cached[i] && cached[i] !== img.url) {
        imageOrderIssues.push({
          slug: row.slug,
          issue: "images JSON out of sync with listingImages",
          index: i,
        });
      }
    }
  }

  const productsOwnedAfter = await prisma.stockListing.count({
    where: { userId: dest.id },
  });

  console.log("\n=== FINAL IMPORT REPORT ===");
  console.log(
    JSON.stringify(
      {
        destination: {
          username: `@${dest.username}`,
          displayName: dest.name,
          userId: dest.id,
          productsOwnedBefore,
          productsOwnedAfter,
        },
        summary: {
          exportedListings: products.length,
          created: imported,
          updated,
          duplicateKeyUpdates: skippedDuplicates,
          failed,
          imagesUploaded,
          dbListingImageRows: dbImageRows,
          listingsMissingImages: missingImageRows,
          orphanedBlobUploads: orphanUploads.length,
          wrongOwnerCount: wrongOwner.length,
          notArchivedCount: notArchived.length,
          availableCount: availableStatus.length,
          imageOrderIssues: imageOrderIssues.length,
        },
        products: importedRows,
        failures,
        orphanUploads,
        wrongOwner: wrongOwner.map((r) => ({
          id: r.id,
          slug: r.slug,
          userId: r.userId,
          username: r.user.username,
        })),
        notArchived: notArchived.map((r) => ({
          id: r.id,
          slug: r.slug,
          saleStatus: r.saleStatus,
        })),
        note: "No listings were set to AVAILABLE. saleStatus=ARCHIVED for all imports.",
        appLogicChanged: false,
      },
      null,
      2,
    ),
  );

  if (wrongOwner.length || availableStatus.length) {
    console.error(
      "\nCRITICAL: ownership or AVAILABLE status check failed — inspect report above.",
    );
    process.exit(2);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
