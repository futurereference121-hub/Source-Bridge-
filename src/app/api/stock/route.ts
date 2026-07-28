import { NextRequest } from "next/server";
import type { z } from "zod";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { jsonError, stockSchema } from "@/lib/validation";
import { CLOTHING_CATEGORIES } from "@/lib/clothing";
import { listCategoryNames } from "@/lib/categories-db";
import { dbStockToListing } from "@/lib/member-map";
import { buildListingSlug } from "@/lib/listings-service";

type StockInput = z.infer<typeof stockSchema>;

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
    currency: data.currency || "USD",
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

export async function GET() {
  try {
    const user = await requireSessionUser();
    const rows = await prisma.stockListing.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    return Response.json({ listings: rows.map(dbStockToListing) });
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

    return Response.json({ ok: true, listing: dbStockToListing(row) });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[stock]", err);
    return jsonError("Could not add stock", 500);
  }
}
