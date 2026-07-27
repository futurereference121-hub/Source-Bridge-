import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { jsonError, stockSchema } from "@/lib/validation";
import { listCategoryNames } from "@/lib/categories-db";
import { dbStockToListing } from "@/lib/member-map";

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${base || "item"}-${Date.now().toString(36)}`;
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

    const body = await req.json();
    const parsed = stockSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid stock", 400);
    }

    const allowed = await listCategoryNames();
    if (
      !allowed.some(
        (c) => c.toLowerCase() === parsed.data.category.toLowerCase(),
      )
    ) {
      return jsonError("Select a category from the list", 400);
    }

    const row = await prisma.stockListing.create({
      data: {
        userId: user.id,
        name: parsed.data.name,
        slug: slugify(parsed.data.name),
        description: parsed.data.description || "",
        category: parsed.data.category,
        images: JSON.stringify(parsed.data.images || []),
        quantity: parsed.data.quantity || "",
        availability: parsed.data.availability,
        location: parsed.data.location || "",
        price: parsed.data.price ?? null,
        currency: parsed.data.currency || "USD",
      },
    });

    return Response.json({ ok: true, listing: dbStockToListing(row) });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[stock]", err);
    return jsonError("Could not add stock", 500);
  }
}
