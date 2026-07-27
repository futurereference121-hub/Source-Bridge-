import { prisma } from "@/lib/db";
import {
  getListingBySlug as getSeedListingBySlug,
  getRelatedListings as getSeedRelated,
  availabilityLabel,
  formatPrice,
} from "@/data/products";
import { getMemberForListing as getSeedMemberForListing } from "@/data/members";
import { dbStockToListing } from "@/lib/member-map";
import { getMemberByIdAsync } from "@/lib/members-service";
import type { Listing, Member } from "@/lib/types";
import type { StockListing as DbStock } from "@prisma/client";

export { availabilityLabel, formatPrice };

function cleanListingSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

/** Stable, readable slug without embedding opaque timestamps when possible. */
export function buildListingSlug(name: string, existing?: string[]): string {
  const base = cleanListingSlug(name) || "item";
  if (!existing?.includes(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!existing.includes(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36).slice(-6)}`;
}

export async function getListingBySlugAsync(
  slug: string,
): Promise<Listing | null> {
  const seed = getSeedListingBySlug(slug);
  if (seed) return seed;

  try {
    const row = await prisma.stockListing.findUnique({ where: { slug } });
    if (!row) {
      // Soft fallback: older slugs may have trailing cuid fragments after rename attempts.
      const fuzzy = await prisma.stockListing.findFirst({
        where: {
          OR: [
            { slug: { startsWith: `${slug}-` } },
            { id: slug },
          ],
        },
      });
      if (!fuzzy) return null;
      return dbStockToListing(fuzzy);
    }
    return dbStockToListing(row);
  } catch (err) {
    console.error("[listings] slug lookup failed", err);
    return null;
  }
}

export async function getMemberForListingAsync(
  listing: Listing,
): Promise<Member | null> {
  const real = await getMemberByIdAsync(listing.memberId);
  if (real) return real;
  return getSeedMemberForListing(listing) ?? null;
}

export async function getRelatedListingsAsync(
  listing: Listing,
  limit = 4,
): Promise<Listing[]> {
  if (!listing.isDbListing) {
    return getSeedRelated(listing, limit);
  }
  try {
    const rows = await prisma.stockListing.findMany({
      where: {
        category: listing.category,
        NOT: { id: listing.id },
        user: { onboardingComplete: true, emailVerified: true },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(dbStockToListing);
  } catch {
    return [];
  }
}

export async function listPublicListingsPage(opts?: {
  cursor?: string;
  limit?: number;
  userId?: string;
}): Promise<{ items: Listing[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(opts?.limit ?? 24, 1), 50);
  const rows = await prisma.stockListing.findMany({
    where: {
      ...(opts?.userId ? { userId: opts.userId } : {}),
      user: { onboardingComplete: true, emailVerified: true },
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(opts?.cursor
      ? { cursor: { id: opts.cursor }, skip: 1 }
      : {}),
  });
  const slice = rows.slice(0, limit);
  return {
    items: slice.map(dbStockToListing),
    nextCursor: rows.length > limit ? slice[slice.length - 1]?.id ?? null : null,
  };
}

export function mapStockRow(row: DbStock): Listing {
  return dbStockToListing(row);
}
