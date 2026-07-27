import type {
  FeedItem,
  Listing,
  ListingAvailability,
  Member,
  MemberStatus,
  NetworkCity,
  Opportunity,
  Review,
  Trip,
} from "@/lib/types";
import type {
  NetworkLocation as DbNetwork,
  Opportunity as DbOpportunity,
  Review as DbReview,
  StatusUpdate as DbStatus,
  StockListing as DbStock,
  Trip as DbTrip,
  User,
} from "@prisma/client";
import { isStatusActive } from "@/lib/member-status";
import { memberCover, memberPhoto, PLACEHOLDER_PRODUCT } from "@/lib/placeholders";

export type DbUserBundle = User & {
  networkLocations?: DbNetwork[];
  trips?: DbTrip[];
  statuses?: DbStatus[];
  opportunities?: DbOpportunity[];
  listings?: DbStock[];
  reviewsReceived?: DbReview[];
  followerCount?: number;
  followingCount?: number;
};

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

function formatTripRange(arrival: string, departure: string): string {
  if (!arrival && !departure) return "";
  if (arrival && departure && arrival !== departure) {
    return `${arrival} → ${departure}`;
  }
  return arrival || departure;
}

function activeStatus(statuses: DbStatus[] | undefined): MemberStatus | null {
  if (!statuses?.length) return null;
  const sorted = [...statuses].sort(
    (a, b) => b.postedAt.getTime() - a.postedAt.getTime(),
  );
  const newest = sorted[0];
  const mapped: MemberStatus = {
    text: newest.text,
    postedAt: newest.postedAt.toISOString(),
    expiresAt: newest.expiresAt.toISOString(),
  };
  return isStatusActive(mapped) ? mapped : null;
}

function isOpportunityActive(o: DbOpportunity, now = new Date()): boolean {
  if (o.closedAt) return false;
  if (o.expiresAt && o.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

function mapOpportunity(o: DbOpportunity): Opportunity {
  return {
    id: o.id,
    title: o.title,
    summary: o.title,
    description: o.description,
    availability: undefined,
    travel: undefined,
    localAccess: undefined,
    stock: undefined,
    categories: o.category ? [o.category] : [],
    category: o.category,
    city: o.city,
    country: o.country,
    postedAt: o.postedAt.toISOString(),
    expiresAt: o.expiresAt?.toISOString() ?? null,
    closedAt: o.closedAt?.toISOString() ?? null,
  };
}

function mapNetwork(rows: DbNetwork[] | undefined): NetworkCity[] {
  if (!rows?.length) return [];
  return [...rows]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((n) => ({
      city: n.city,
      country: n.country,
      cityCode: n.city.toLowerCase(),
    }));
}

function mapTrips(rows: DbTrip[] | undefined): Trip[] {
  if (!rows?.length) return [];
  return rows.map((t) => ({
    id: t.id,
    city: t.city,
    country: t.country,
    arrival: t.arrival,
    departure: t.departure,
    dateRange: formatTripRange(t.arrival, t.departure),
  }));
}

function mapReviews(rows: DbReview[] | undefined): Review[] {
  if (!rows?.length) return [];
  return rows.map((r) => ({
    id: r.id,
    authorName: r.authorName,
    rating: r.rating,
    text: r.text,
    dateLabel: r.createdAt.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    }),
  }));
}

export function dbUserToMember(user: DbUserBundle): Member | null {
  if (!user.username || !user.slug || !user.onboardingComplete) return null;

  const specialties = parseJsonArray(user.specialties);
  const activeOpps = (user.opportunities ?? []).filter((o) =>
    isOpportunityActive(o),
  );
  const newestOpp = activeOpps.sort(
    (a, b) => b.postedAt.getTime() - a.postedAt.getTime(),
  )[0];

  const listingIds = (user.listings ?? []).map((l) => l.id);
  const followerCount = user.followerCount ?? 0;
  const followingCount = user.followingCount ?? 0;

  return {
    id: user.id,
    slug: user.slug,
    username: user.username,
    fullName: user.name,
    photo: memberPhoto(user.photo),
    cover: memberCover(user.cover),
    location: {
      city: user.city || "",
      country: user.country || "",
      label:
        user.city && user.country
          ? `${user.city}, ${user.country}`
          : user.city || user.country || "",
      cityCode: user.city ? user.city.toLowerCase() : undefined,
    },
    howICanHelp: user.publicDisplayMessage || "",
    publicDisplayMessage: user.publicDisplayMessage || "",
    bio: user.bio || "",
    memberType: (user.memberType as Member["memberType"]) || "local",
    verification: {
      identityVerified: user.identityVerified,
      badges: user.identityVerified
        ? [{ kind: "verified_identity", label: "Verified" }]
        : [],
    },
    emailVerified: user.emailVerified,
    identityVerified: user.identityVerified,
    bridgeScore: 0,
    rating: 0,
    completedRequests: 0,
    services: specialties.map((label, i) => ({ id: `sp-${i}`, label })),
    network: mapNetwork(user.networkLocations),
    trips: mapTrips(user.trips),
    status: activeStatus(user.statuses),
    opportunity: newestOpp ? mapOpportunity(newestOpp) : null,
    opportunities: activeOpps.map(mapOpportunity),
    connectedCountries: [],
    upcomingJourney: null,
    journeys: [],
    availability: "available_now",
    availabilityLabel: "Available now",
    listingIds,
    reviews: mapReviews(user.reviewsReceived),
    recentActivity: [],
    languages: [],
    joinedAt: user.createdAt.toISOString().slice(0, 10),
    isPrototype: false,
    followerCount,
    followingCount,
    isRealAccount: true,
  };
}

export function dbStockToListing(row: DbStock): Listing {
  const images = parseJsonArray(row.images);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    images: images.length ? images : [PLACEHOLDER_PRODUCT],
    price: row.price ?? 0,
    currency: (row.currency as Listing["currency"]) || "USD",
    memberId: row.userId,
    country: "",
    currentLocation: row.location || "",
    shippingAvailable: false,
    availability: row.availability as ListingAvailability,
    tags: [],
    featured: false,
    quantity: row.quantity,
  };
}

export function statusToFeedItem(
  member: Member,
  status: MemberStatus,
): FeedItem {
  return {
    id: `status-${member.id}-${status.postedAt}`,
    kind: "status",
    memberId: member.id,
    memberSlug: member.slug,
    username: member.username,
    fullName: member.fullName,
    photo: member.photo,
    text: status.text,
    postedAt: status.postedAt,
    expiresAt: status.expiresAt,
  };
}

export function opportunityToFeedItem(
  member: Member,
  opp: Opportunity,
): FeedItem {
  return {
    id: `opp-${opp.id}`,
    kind: "opportunity",
    memberId: member.id,
    memberSlug: member.slug,
    username: member.username,
    fullName: member.fullName,
    photo: member.photo,
    text: opp.title || opp.summary,
    postedAt: opp.postedAt,
    expiresAt: opp.expiresAt ?? undefined,
  };
}
