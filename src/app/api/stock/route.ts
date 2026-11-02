import { NextRequest } from "next/server";
import type { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { jsonError, stockSchema } from "@/lib/validation";
import { CLOTHING_CATEGORIES } from "@/lib/clothing";
import { listCategoryNames } from "@/lib/categories-db";
import { dbStockToListing } from "@/lib/member-map";
import { buildListingSlug } from "@/lib/listings-service";
import { syncListingImages } from "@/lib/listing-images";
import {
  encodeListingPaymentOptions,
  DEFAULT_LISTING_PAYMENT_OPTION,
  listingAllowsProtected,
  parseListingPaymentOptions,
} from "@/lib/payments/listing-options";
import { getPlatformPaymentConfig } from "@/lib/payments/config";
import { resolvePayoutRail } from "@/lib/payments/payout-rail/rail-resolver";
import {
  assertListingCurrencyForPublish,
  defaultListingCurrency,
  gpListingMinimumCopy,
  gpListingMinimumMinor,
  listingCurrencyChoices,
} from "@/lib/payments/listing-currency";

type StockInput = z.infer<typeof stockSchema>;

function resolvePaymentOptions(data: StockInput): string {
  if (
    data.protectedPaymentEnabled !== undefined ||
    data.directPaymentEnabled !== undefined
  ) {
    return encodeListingPaymentOptions({
      protectedPaymentEnabled: Boolean(data.protectedPaymentEnabled),
      directPaymentEnabled: Boolean(data.directPaymentEnabled),
    });
  }
  if (data.paymentOptions) return data.paymentOptions;
  return DEFAULT_LISTING_PAYMENT_OPTION;
}

function stockCreateData(userId: string, data: StockInput, slug: string) {
  const shipLabel = `${data.shipFromCity}, ${data.shipFromCountry}`;
  return {
    userId,
    name: data.name,
    slug,
    description: data.description,
    productKind: data.productKind,
    category: data.category,
    subcategory: data.subcategory || "",
    images: JSON.stringify(data.images),
    quantity: data.quantity || "",
    sizes: JSON.stringify(data.sizes || []),
    material: data.material || "",
    brand: data.brand || "",
    condition: data.condition || "",
    colour: data.colour || "",
    pattern: data.pattern || "",
    fit: data.fit || "",
    gender: data.gender || "",
    availability: data.availability,
    saleStatus: data.saleStatus || "AVAILABLE",
    location: data.location || shipLabel,
    shipFromCity: data.shipFromCity,
    shipFromCountry: data.shipFromCountry,
    shippingAvailable: data.shippingAvailable,
    price: data.price,
    currency: data.currency,
    paymentOptions: resolvePaymentOptions(data),
  };
}

async function assertCategoryAllowed(category: string, productKind: string) {
  if (productKind === "clothing") {
    const ok = CLOTHING_CATEGORIES.some(
      (c) => c.toLowerCase() === category.toLowerCase(),
    );
    if (!ok) return jsonError("Select a clothing category", 400);
    return null;
  }
  const allowed = await listCategoryNames();
  if (!allowed.some((c) => c.toLowerCase() === category.toLowerCase())) {
    return jsonError("Select a category from the list", 400);
  }
  return null;
}

async function listingCurrencyPolicyForUser(user: {
  id: string;
  email?: string | null;
}) {
  const config = await getPlatformPaymentConfig();
  const rail = await resolvePayoutRail({
    userId: user.id,
    email: user.email,
  });
  const gpProtected = rail.rail === "STRIPE_GLOBAL_PAYOUTS";
  return {
    gpProtected,
    defaultCurrency: defaultListingCurrency(gpProtected),
    options: listingCurrencyChoices({
      gpProtected,
      allowedCurrencies: config.allowedCurrencies,
    }),
    minimumMinor: gpProtected ? gpListingMinimumMinor() : null,
    minimumCopy: gpProtected ? gpListingMinimumCopy() : null,
  };
}

export async function GET() {
  try {
    const user = await requireSessionUser();
    const rows = await prisma.stockListing.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: { listingImages: { orderBy: { sortOrder: "asc" } } },
    });
    const currencyPolicy = await listingCurrencyPolicyForUser(user);
    return Response.json({
      listings: rows.map(dbStockToListing),
      currencyPolicy,
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    return jsonError("Failed to load stock", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (!user.emailVerified) return jsonError("Verify email first", 403);
    if (!user.onboardingComplete) {
      return jsonError("Complete your profile before adding listings", 403);
    }

    const body = await req.json();
    const parsed = stockSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid stock", 400);
    }

    const catErr = await assertCategoryAllowed(
      parsed.data.category,
      parsed.data.productKind,
    );
    if (catErr) return catErr;

    if (
      parsed.data.productKind === "clothing" &&
      !(parsed.data.sizes && parsed.data.sizes.length)
    ) {
      return jsonError("Select at least one size", 400);
    }

    let paymentOptions: string;
    try {
      paymentOptions = resolvePaymentOptions(parsed.data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Choose at least one payment option.";
      return jsonError(message, 400);
    }

    const config = await getPlatformPaymentConfig();
    const rail = await resolvePayoutRail({
      userId: user.id,
      email: user.email,
    });
    const gpProtected =
      rail.rail === "STRIPE_GLOBAL_PAYOUTS" &&
      listingAllowsProtected(parseListingPaymentOptions(paymentOptions));
    try {
      const providedCurrency =
        typeof body.currency === "string" && body.currency.trim()
          ? parsed.data.currency
          : defaultListingCurrency(gpProtected);
      parsed.data.currency = assertListingCurrencyForPublish({
        currency: providedCurrency,
        priceMajor: parsed.data.price,
        gpProtected,
        allowedCurrencies: config.allowedCurrencies,
      });
    } catch (err) {
      const status = (err as { status?: number }).status || 400;
      const code = (err as { code?: string }).code;
      const message = err instanceof Error ? err.message : "Invalid currency";
      return jsonError(message, status, code ? { code } : undefined);
    }

    const existing = await prisma.stockListing.findMany({
      select: { slug: true },
    });
    const slug = buildListingSlug(
      parsed.data.name,
      existing.map((r) => r.slug),
    );

    const row = await prisma.stockListing.create({
      data: stockCreateData(user.id, parsed.data, slug),
    });
    await syncListingImages(row.id, parsed.data.images);
    const hydrated = await prisma.stockListing.findUniqueOrThrow({
      where: { id: row.id },
      include: { listingImages: { orderBy: { sortOrder: "asc" } } },
    });

    return Response.json({ ok: true, listing: dbStockToListing(hydrated) });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[stock]", err);
    return jsonError("Could not add stock", 500);
  }
}
