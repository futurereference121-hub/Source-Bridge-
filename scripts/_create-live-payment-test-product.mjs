/**
 * One-shot: create temp LIVE Payment Test Product for @theowlsaid.
 * Data-only — no app source hard-coding. No Stripe money objects.
 *
 * Run: node --env-file=.env.local --import tsx scripts/_create-live-payment-test-product.mjs
 */
import { PrismaClient } from "@prisma/client";
import { calculateFees } from "../src/lib/payments/fees.ts";
import { getPlatformPaymentConfig } from "../src/lib/payments/config.ts";
import { majorToMinor, totalChargeMinor, formatMinor } from "../src/lib/payments/money.ts";
import { SOURCE_BRIDGE_FEE_BPS } from "../src/lib/payments/config.ts";
import { PLACEHOLDER_PRODUCT } from "../src/lib/placeholders.ts";

const TITLE = "LIVE Payment Test Product";
const DESCRIPTION =
  "Temporary Source Bridge product listing for LIVE protected-payment flow testing.";
const PRICE_MAJOR = 1;
const CURRENCY = "USD";
const OWNER_USERNAME = "theowlsaid";

const prisma = new PrismaClient();

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL missing");
    process.exit(1);
  }

  const config = await getPlatformPaymentConfig();
  const itemCostMinor = majorToMinor(PRICE_MAJOR, CURRENCY);
  const fees = calculateFees({
    itemCostMinor,
    shippingMinor: 0,
    config,
    paymentOption: "PROTECTED",
  });
  const total = totalChargeMinor(fees);

  console.log("FEE_CHECK", {
    sourceBridgeFeeBpsCode: SOURCE_BRIDGE_FEE_BPS,
    protectionFeeBpsRuntime: config.protectionFeeBps,
    directServiceFeeBpsRuntime: config.directServiceFeeBps,
    itemCostMinor,
    protectionFeeMinor: fees.protectionFeeMinor,
    totalChargeMinor: total,
    itemLabel: formatMinor(itemCostMinor, CURRENCY),
    feeLabel: formatMinor(fees.protectionFeeMinor, CURRENCY),
    totalLabel: formatMinor(total, CURRENCY),
  });

  if (config.protectionFeeBps !== 700) {
    console.error(
      "PRODUCT PURCHASE FEE MODEL MISMATCH — expected protectionFeeBps=700 (7%), got",
      config.protectionFeeBps,
    );
    process.exit(2);
  }
  if (fees.protectionFeeMinor !== 7 || total !== 107) {
    console.error(
      "PRODUCT PURCHASE FEE MODEL MISMATCH — for $1.00 expected fee $0.07 / total $1.07, got",
      {
        protectionFeeMinor: fees.protectionFeeMinor,
        totalChargeMinor: total,
      },
    );
    process.exit(2);
  }

  const owner = await prisma.user.findFirst({
    where: {
      username: { equals: OWNER_USERNAME, mode: "insensitive" },
      deletedAt: null,
    },
    select: {
      id: true,
      username: true,
      city: true,
      country: true,
      email: true,
    },
  });
  if (!owner) {
    console.error("Owner not found:", OWNER_USERNAME);
    process.exit(1);
  }

  const existing = await prisma.stockListing.findFirst({
    where: {
      userId: owner.id,
      name: TITLE,
      saleStatus: { not: "ARCHIVED" },
    },
    include: { listingImages: true },
  });

  let categories = await prisma.category.findMany({
    take: 5,
    orderBy: { name: "asc" },
    select: { name: true },
  });
  if (!categories.length) {
    await prisma.category.create({
      data: {
        slug: "general",
        name: "General",
        description: "General marketplace items",
        image: "",
      },
    });
    categories = [{ name: "General" }];
  }
  const category = categories[0].name;

  const images = [PLACEHOLDER_PRODUCT];
  const baseSlug = slugify(TITLE);
  const existingSlugs = (
    await prisma.stockListing.findMany({ select: { slug: true } })
  ).map((r) => r.slug);

  let slug = baseSlug;
  if (existingSlugs.includes(slug) && existing?.slug !== slug) {
    let i = 2;
    while (existingSlugs.includes(`${baseSlug}-${i}`)) i += 1;
    slug = `${baseSlug}-${i}`;
  }

  const listingData = {
    name: TITLE,
    slug: existing?.slug || slug,
    description: DESCRIPTION,
    productKind: "general",
    category,
    subcategory: "",
    images: JSON.stringify(images),
    quantity: "1",
    sizes: "[]",
    availability: "available",
    saleStatus: "AVAILABLE",
    location:
      owner.city && owner.country
        ? `${owner.city}, ${owner.country}`
        : owner.country || owner.city || "",
    shipFromCity: owner.city || "",
    shipFromCountry: owner.country || "",
    shippingAvailable: false,
    price: PRICE_MAJOR,
    currency: CURRENCY,
    paymentOptions: "PROTECTED_ONLY",
    attributes: JSON.stringify({
      tempLivePaymentTest: true,
      createdFor: "LIVE protected-payment flow testing",
    }),
  };

  let listing;
  if (existing) {
    listing = await prisma.$transaction(async (tx) => {
      const updated = await tx.stockListing.update({
        where: { id: existing.id },
        data: listingData,
      });
      await tx.listingImage.deleteMany({ where: { listingId: existing.id } });
      await tx.listingImage.create({
        data: {
          listingId: existing.id,
          url: images[0],
          sortOrder: 0,
          isCover: true,
        },
      });
      return updated;
    });
    console.log("LISTING_UPDATED", {
      id: listing.id,
      slug: listing.slug,
      owner: owner.username,
      price: listing.price,
      currency: listing.currency,
      saleStatus: listing.saleStatus,
      paymentOptions: listing.paymentOptions,
      quantity: listing.quantity,
    });
  } else {
    listing = await prisma.$transaction(async (tx) => {
      return tx.stockListing.create({
        data: {
          userId: owner.id,
          ...listingData,
          listingImages: {
            create: [
              {
                url: images[0],
                sortOrder: 0,
                isCover: true,
              },
            ],
          },
        },
      });
    });
    console.log("LISTING_CREATED", {
      id: listing.id,
      slug: listing.slug,
      owner: owner.username,
      price: listing.price,
      currency: listing.currency,
      saleStatus: listing.saleStatus,
      paymentOptions: listing.paymentOptions,
      quantity: listing.quantity,
    });
  }

  console.log("CHECKOUT_PATH", `/checkout/${listing.slug}`);
  console.log("PRODUCT_URL", `/listings/${listing.slug}`);
  console.log(
    "EXPECTED_BUYER_TOTAL",
    formatMinor(107, CURRENCY),
    "(item $1.00 + 7% fee $0.07)",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
