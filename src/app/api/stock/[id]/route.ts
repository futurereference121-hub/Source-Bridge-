import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { jsonError, stockSchema } from "@/lib/validation";
import { CLOTHING_CATEGORIES } from "@/lib/clothing";
import { listCategoryNames } from "@/lib/categories-db";
import { dbStockToListing } from "@/lib/member-map";
import { deleteStoredImageForUser } from "@/lib/storage";

type Ctx = { params: Promise<{ id: string }> };

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

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireSessionUser();
    const { id } = await ctx.params;
    const existing = await prisma.stockListing.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) {
      return jsonError("Stock item not found", 404);
    }

    const body = await req.json();
    const parsed = stockSchema.partial().safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }
    const data = parsed.data;
    const productKind = data.productKind || existing.productKind || "clothing";
    if (data.category) {
      const catErr = await assertCategoryAllowed(data.category, productKind);
      if (catErr) return catErr;
    }

    const shipCity = data.shipFromCity ?? existing.shipFromCity;
    const shipCountry = data.shipFromCountry ?? existing.shipFromCountry;
    const shipLabel =
      shipCity && shipCountry ? `${shipCity}, ${shipCountry}` : existing.location;

    const row = await prisma.stockListing.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.productKind !== undefined
          ? { productKind: data.productKind }
          : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.subcategory !== undefined
          ? { subcategory: data.subcategory }
          : {}),
        ...(data.images !== undefined
          ? { images: JSON.stringify(data.images) }
          : {}),
        ...(data.quantity !== undefined ? { quantity: data.quantity } : {}),
        ...(data.sizes !== undefined
          ? { sizes: JSON.stringify(data.sizes) }
          : {}),
        ...(data.material !== undefined ? { material: data.material } : {}),
        ...(data.brand !== undefined ? { brand: data.brand } : {}),
        ...(data.condition !== undefined ? { condition: data.condition } : {}),
        ...(data.colour !== undefined ? { colour: data.colour } : {}),
        ...(data.pattern !== undefined ? { pattern: data.pattern } : {}),
        ...(data.fit !== undefined ? { fit: data.fit } : {}),
        ...(data.gender !== undefined ? { gender: data.gender } : {}),
        ...(data.availability !== undefined
          ? { availability: data.availability }
          : {}),
        ...(data.saleStatus !== undefined
          ? { saleStatus: data.saleStatus }
          : {}),
        ...(data.shipFromCity !== undefined
          ? { shipFromCity: data.shipFromCity }
          : {}),
        ...(data.shipFromCountry !== undefined
          ? { shipFromCountry: data.shipFromCountry }
          : {}),
        ...(data.shippingAvailable !== undefined
          ? { shippingAvailable: data.shippingAvailable }
          : {}),
        location: data.location !== undefined ? data.location : shipLabel,
        ...(data.price !== undefined ? { price: data.price } : {}),
        ...(data.currency !== undefined ? { currency: data.currency } : {}),
      },
    });

    return Response.json({ ok: true, listing: dbStockToListing(row) });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[stock:patch]", err);
    return jsonError("Update failed", 500);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await requireSessionUser();
    const { id } = await ctx.params;
    const existing = await prisma.stockListing.findUnique({ where: { id } });
    if (!existing || existing.userId !== user.id) {
      return jsonError("Stock item not found", 404);
    }

    let imageUrls: string[] = [];
    try {
      const parsed = JSON.parse(existing.images || "[]") as unknown;
      if (Array.isArray(parsed)) {
        imageUrls = parsed.filter((x): x is string => typeof x === "string");
      }
    } catch {
      imageUrls = [];
    }

    await prisma.stockListing.delete({ where: { id } });

    for (const url of imageUrls) {
      try {
        await deleteStoredImageForUser(url, user.id);
      } catch (err) {
        console.error("[stock:delete:blob]", url, err);
      }
    }

    return Response.json({ ok: true });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    return jsonError("Delete failed", 500);
  }
}
