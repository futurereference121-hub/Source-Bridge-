import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { publicMemberWhere } from "@/lib/discoverability";
import {
  mapOpportunityPublic,
  type OpportunityPublic,
} from "@/lib/opportunities/map";
import { mapOpportunitySummary } from "@/lib/opportunities/public-teaser";
import {
  PUBLIC_ACTIVE_LIFECYCLES,
} from "@/lib/opportunities/lifecycle";
import {
  decodeCursor,
  encodeCursor,
  normalizePlaceToken,
} from "@/lib/opportunities/normalize";
import type { CreatableOpportunityKind } from "@/lib/opportunities/kinds";

export type MarketplaceFilters = {
  mode: "for_you" | "latest";
  cursor?: string | null;
  limit: number;
  kind?: string;
  country?: string;
  city?: string;
  category?: string;
  deliveryCountry?: string;
  deliveryCity?: string;
  openOnly?: boolean;
  deadlineFrom?: Date | null;
  deadlineTo?: Date | null;
  viewerId?: string | null;
};

const CREATOR_SELECT = {
  id: true,
  username: true,
  name: true,
  slug: true,
  photo: true,
} as const;

function publicWhere(
  filters: MarketplaceFilters,
  now = new Date(),
): Prisma.OpportunityWhereInput {
  const and: Prisma.OpportunityWhereInput[] = [
    {
      lifecycle: { in: [...PUBLIC_ACTIVE_LIFECYCLES] },
      closedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      user: publicMemberWhere,
    },
  ];

  if (filters.kind && filters.kind !== "ALL") {
    and.push({ kind: filters.kind });
  }
  if (filters.openOnly) {
    and.push({ lifecycle: "OPEN" });
  }
  if (filters.country) {
    const c = normalizePlaceToken(filters.country);
    and.push({
      OR: [
        { country: { contains: filters.country, mode: "insensitive" } },
        { sourceCountry: { contains: filters.country, mode: "insensitive" } },
        { deliveryCountry: { contains: filters.country, mode: "insensitive" } },
      ],
    });
    void c;
  }
  if (filters.city) {
    and.push({
      OR: [
        { city: { contains: filters.city, mode: "insensitive" } },
        { sourceCity: { contains: filters.city, mode: "insensitive" } },
        { deliveryCity: { contains: filters.city, mode: "insensitive" } },
      ],
    });
  }
  if (filters.deliveryCountry) {
    and.push({
      deliveryCountry: {
        contains: filters.deliveryCountry,
        mode: "insensitive",
      },
    });
  }
  if (filters.deliveryCity) {
    and.push({
      deliveryCity: { contains: filters.deliveryCity, mode: "insensitive" },
    });
  }
  if (filters.category) {
    and.push({
      OR: [
        { category: { contains: filters.category, mode: "insensitive" } },
        { categoriesJson: { contains: filters.category, mode: "insensitive" } },
      ],
    });
  }
  if (filters.deadlineFrom || filters.deadlineTo) {
    and.push({
      expiresAt: {
        ...(filters.deadlineFrom ? { gte: filters.deadlineFrom } : {}),
        ...(filters.deadlineTo ? { lte: filters.deadlineTo } : {}),
      },
    });
  }

  return { AND: and };
}

/**
 * Latest feed: stable chronological cursor (postedAt desc, id desc).
 */
export async function listLatestOpportunities(filters: MarketplaceFilters): Promise<{
  items: OpportunityPublic[];
  nextCursor: string | null;
}> {
  const now = new Date();
  const where = publicWhere(filters, now);
  const cursor = decodeCursor(filters.cursor);
  const take = filters.limit + 1;

  const rows = await prisma.opportunity.findMany({
    where: cursor
      ? {
          AND: [
            where,
            {
              OR: [
                { postedAt: { lt: new Date(cursor.postedAt) } },
                {
                  postedAt: new Date(cursor.postedAt),
                  id: { lt: cursor.id },
                },
              ],
            },
          ],
        }
      : where,
    orderBy: [{ postedAt: "desc" }, { id: "desc" }],
    take,
    include: { user: { select: CREATOR_SELECT } },
  });

  const page = rows.slice(0, filters.limit);
  const items = page.map((r) =>
    mapOpportunitySummary(mapOpportunityPublic(r, now)),
  );
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > filters.limit && last
      ? encodeCursor({
          postedAt: last.postedAt.toISOString(),
          id: last.id,
        })
      : null;

  // Fair exposure: bump low-exposure rows that appeared (bounded, non-blocking).
  if (page.length) {
    void prisma.opportunity
      .updateMany({
        where: { id: { in: page.map((p) => p.id) } },
        data: {
          exposureScore: { increment: 1 },
          lastExposedAt: now,
        },
      })
      .catch(() => {});
  }

  return { items, nextCursor };
}

type ViewerSignals = {
  city: string;
  country: string;
  network: { city: string; country: string }[];
  trips: { city: string; country: string }[];
  followingIds: Set<string>;
};

async function loadViewerSignals(viewerId: string): Promise<ViewerSignals | null> {
  const user = await prisma.user.findUnique({
    where: { id: viewerId },
    select: {
      city: true,
      country: true,
      networkLocations: {
        select: { city: true, country: true },
        take: 20,
      },
      trips: { select: { city: true, country: true }, take: 20 },
      following: { select: { followingId: true }, take: 200 },
    },
  });
  if (!user) return null;
  return {
    city: user.city || "",
    country: user.country || "",
    network: user.networkLocations,
    trips: user.trips,
    followingIds: new Set(user.following.map((f) => f.followingId)),
  };
}

function placeMatch(
  city: string,
  country: string,
  targetCity: string,
  targetCountry: string,
): number {
  const c = normalizePlaceToken(city);
  const co = normalizePlaceToken(country);
  const tc = normalizePlaceToken(targetCity);
  const tco = normalizePlaceToken(targetCountry);
  let score = 0;
  if (co && tco && co === tco) score += 8;
  if (c && tc && c === tc) score += 12;
  return score;
}

function scoreOpportunity(
  row: {
    id: string;
    userId: string;
    kind: string;
    city: string;
    country: string;
    sourceCity: string;
    sourceCountry: string;
    deliveryCity: string;
    deliveryCountry: string;
    postedAt: Date;
    expiresAt: Date | null;
    exposureScore: number;
    category: string;
  },
  signals: ViewerSignals | null,
  now: Date,
): number {
  let score = 0;
  // Freshness
  const ageHours = Math.max(
    0,
    (now.getTime() - row.postedAt.getTime()) / (60 * 60 * 1000),
  );
  score += Math.max(0, 40 - ageHours);

  // Deadline urgency (Buyer Request / any with expiry soon)
  if (row.expiresAt) {
    const hoursLeft =
      (row.expiresAt.getTime() - now.getTime()) / (60 * 60 * 1000);
    if (hoursLeft > 0 && hoursLeft < 72) score += 15;
    else if (hoursLeft > 0 && hoursLeft < 168) score += 8;
  }

  // Fair rotation for low exposure / new posts
  if (row.exposureScore < 3) score += 18;
  else if (row.exposureScore < 10) score += 8;
  else score -= Math.min(12, Math.floor(row.exposureScore / 20));

  if (!signals) {
    // Cold-start: slight boost for diverse countries via exposure only
    return score;
  }

  if (signals.followingIds.has(row.userId)) score += 25;

  score += placeMatch(
    signals.city,
    signals.country,
    row.sourceCity || row.city,
    row.sourceCountry || row.country,
  );
  score += placeMatch(
    signals.city,
    signals.country,
    row.deliveryCity,
    row.deliveryCountry,
  );

  for (const n of signals.network) {
    score += placeMatch(
      n.city,
      n.country,
      row.sourceCity || row.city,
      row.sourceCountry || row.country,
    );
  }
  for (const t of signals.trips) {
    score +=
      placeMatch(t.city, t.country, row.city, row.country) +
      placeMatch(t.city, t.country, row.deliveryCity, row.deliveryCountry);
  }

  // Kind diversity soft preference when viewer has trips → travel opps
  if (signals.trips.length && row.kind === "TRAVEL_OPPORTUNITY") score += 6;
  if (signals.trips.length && row.kind === "BUYER_REQUEST") score += 4;

  return score;
}

/**
 * For You: bounded candidate window + relevance score + stable cursor.
 * No load-all; no per-card API; no fake engagement.
 */
export async function listForYouOpportunities(filters: MarketplaceFilters): Promise<{
  items: OpportunityPublic[];
  nextCursor: string | null;
}> {
  const now = new Date();
  const where = publicWhere(filters, now);
  const signals = filters.viewerId
    ? await loadViewerSignals(filters.viewerId)
    : null;

  // Bounded candidate pool (not unbounded fan-out).
  const candidates = await prisma.opportunity.findMany({
    where,
    orderBy: [{ postedAt: "desc" }, { id: "desc" }],
    take: 120,
    include: { user: { select: CREATOR_SELECT } },
  });

  const scored = candidates
    .map((row) => ({
      row,
      score: scoreOpportunity(row, signals, now),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.row.postedAt.getTime() !== a.row.postedAt.getTime()) {
        return b.row.postedAt.getTime() - a.row.postedAt.getTime();
      }
      return b.row.id < a.row.id ? -1 : 1;
    });

  const cursor = decodeCursor(filters.cursor);
  let start = 0;
  if (cursor) {
    const idx = scored.findIndex(
      (s) =>
        s.row.id === cursor.id ||
        (cursor.score != null &&
          (s.score < cursor.score ||
            (s.score === cursor.score &&
              (s.row.postedAt.getTime() < new Date(cursor.postedAt).getTime() ||
                (s.row.postedAt.toISOString() === cursor.postedAt &&
                  s.row.id < cursor.id))))),
    );
    if (idx >= 0) start = scored[idx].row.id === cursor.id ? idx + 1 : idx;
  }

  const slice = scored.slice(start, start + filters.limit);
  const items = slice.map((s) =>
    mapOpportunitySummary(mapOpportunityPublic(s.row, now)),
  );
  const last = slice[slice.length - 1];
  const hasMore = start + filters.limit < scored.length;
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          postedAt: last.row.postedAt.toISOString(),
          id: last.row.id,
          score: last.score,
        })
      : null;

  if (slice.length) {
    void prisma.opportunity
      .updateMany({
        where: { id: { in: slice.map((s) => s.row.id) } },
        data: {
          exposureScore: { increment: 1 },
          lastExposedAt: now,
        },
      })
      .catch(() => {});
  }

  return { items, nextCursor };
}

export async function listMarketplaceOpportunities(filters: MarketplaceFilters) {
  if (filters.mode === "for_you") return listForYouOpportunities(filters);
  return listLatestOpportunities(filters);
}

export function kindFilterLabel(kind: string): string | null {
  const map: Record<string, CreatableOpportunityKind | "LEGACY_GENERAL"> = {
    BUYER_REQUEST: "BUYER_REQUEST",
    SOURCING_OFFER: "SOURCING_OFFER",
    TRAVEL_OPPORTUNITY: "TRAVEL_OPPORTUNITY",
    LEGACY_GENERAL: "LEGACY_GENERAL",
  };
  return map[kind] || null;
}
