import { prisma } from "@/lib/db";
import { categories as seedCategories } from "@/data/categories";

/** Ensure global categories exist (idempotent). Users select from these; only admins mutate. */
export async function ensureCategoriesSeeded(): Promise<void> {
  const count = await prisma.category.count();
  if (count > 0) return;
  await prisma.category.createMany({
    data: seedCategories.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      description: c.description,
      image: c.image,
    })),
  });
}

export async function listCategoryNames(): Promise<string[]> {
  await ensureCategoriesSeeded();
  const rows = await prisma.category.findMany({
    orderBy: { name: "asc" },
    select: { name: true },
  });
  return rows.map((r) => r.name);
}
