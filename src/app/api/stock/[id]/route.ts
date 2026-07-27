import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { jsonError, stockSchema } from "@/lib/validation";
import { listCategoryNames } from "@/lib/categories-db";
import { dbStockToListing } from "@/lib/member-map";

type Ctx = { params: Promise<{ id: string }> };

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
    if (data.category) {
      const allowed = await listCategoryNames();
      if (
        !allowed.some((c) => c.toLowerCase() === data.category!.toLowerCase())
      ) {
        return jsonError("Select a category from the list", 400);
      }
    }

    const row = await prisma.stockListing.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.images !== undefined
          ? { images: JSON.stringify(data.images) }
          : {}),
        ...(data.quantity !== undefined ? { quantity: data.quantity } : {}),
        ...(data.availability !== undefined
          ? { availability: data.availability }
          : {}),
        ...(data.location !== undefined ? { location: data.location } : {}),
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
    await prisma.stockListing.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    return jsonError("Delete failed", 500);
  }
}
