import { ensureCategoriesSeeded } from "@/lib/categories-db";
import { prisma } from "@/lib/db";
import { getSessionUser, isAdminUser } from "@/lib/auth";
import { jsonError } from "@/lib/validation";

export async function GET() {
  await ensureCategoriesSeeded();
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
  });
  return Response.json({ categories });
}

/** Admin-only create — model the gate; no admin UI yet. */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return jsonError("Sign in required", 401);
  if (!isAdminUser(user)) return jsonError("Admin only", 403);
  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return jsonError("name required", 400);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const row = await prisma.category.create({
    data: { name, slug, description: body.description || "", image: body.image || "" },
  });
  return Response.json({ ok: true, category: row });
}
