import { prisma } from "@/lib/db";
import { members as seedMembers, getMemberBySlug as getSeedBySlug } from "@/data/members";
import { dbUserToMember, type DbUserBundle } from "@/lib/member-map";
import type { Member } from "@/lib/types";
import type { FeedItem } from "@/lib/types";
import { isStatusActive } from "@/lib/member-status";
import { memberPhoto } from "@/lib/placeholders";
import { publicMemberWhere } from "@/lib/discoverability";
import { normalizeSearchHandle } from "@/lib/validation";

/**
 * Self-service lookup only (e.g. /api/profile fetching the signed-in user's
 * own member record). Deliberately does NOT exclude admins/test accounts/
 * non-discoverable users — owners can always see their own data. Never use
 * this for a lookup keyed by anything other than the caller's own session id.
 */
const selfViewableWhere = {
  emailVerified: true,
  onboardingComplete: true,
  username: { not: null },
  slug: { not: null },
  deletedAt: null,
} as const;

/** Directory / explore cards — no listings or reviews. */
const userInclude = {
  networkLocations: { orderBy: { sortOrder: "asc" as const } },
  trips: { orderBy: { arrival: "asc" as const } },
  statuses: { orderBy: { postedAt: "desc" as const }, take: 1 },
  opportunities: { orderBy: { postedAt: "desc" as const }, take: 3 },
};

/** Profile pages — listings, reviews, fuller status/opportunity history. */
const userIncludeFull = {
  networkLocations: { orderBy: { sortOrder: "asc" as const } },
  trips: { orderBy: { arrival: "asc" as const } },
  statuses: { orderBy: { postedAt: "desc" as const }, take: 5 },
  opportunities: { orderBy: { postedAt: "desc" as const }, take: 20 },
  listings: {
    orderBy: { createdAt: "desc" as const },
    include: {
      listingImages: { orderBy: { sortOrder: "asc" as const } },
    },
  },
  reviewsReceived: { orderBy: { createdAt: "desc" as const }, take: 50 },
};

function withSeedDefaults(m: Member): Member {
  return {
    ...m,
    publicDisplayMessage: m.publicDisplayMessage ?? m.howICanHelp ?? "",
    emailVerified: m.emailVerified ?? true,
    identityVerified: m.identityVerified ?? m.verification.identityVerified,
    followerCount: m.followerCount ?? 0,
    followingCount: m.followingCount ?? 0,
    opportunities: m.opportunities ?? (m.opportunity ? [m.opportunity] : []),
  };
}

async function attachFollowCounts(
  users: { id: string }[],
): Promise<Map<string, { followers: number; following: number }>> {
  const ids = users.map((u) => u.id);
  if (!ids.length) return new Map();
  const [followerGroups, followingGroups] = await Promise.all([
    prisma.follow.groupBy({
      by: ["followingId"],
      where: { followingId: { in: ids }, followingIsSeed: false },
      _count: { _all: true },
    }),
    prisma.follow.groupBy({
      by: ["followerId"],
      where: { followerId: { in: ids } },
      _count: { _all: true },
    }),
  ]);
  const followersMap = new Map(
    followerGroups.map((g) => [g.followingId, g._count._all]),
  );
  const followingMap = new Map(
    followingGroups.map((g) => [g.followerId, g._count._all]),
  );
  const out = new Map<string, { followers: number; following: number }>();
  for (const id of ids) {
    out.set(id, {
      followers: followersMap.get(id) ?? 0,
      following: followingMap.get(id) ?? 0,
    });
  }
  return out;
}

async function loadDbMembers(): Promise<Member[]> {
  try {
    const users = await prisma.user.findMany({
      where: publicMemberWhere,
      include: userInclude,
    });
    const counts = await attachFollowCounts(users);

    return users
      .map((u) => {
        const c = counts.get(u.id);
        return dbUserToMember({
          ...(u as DbUserBundle),
          followerCount: c?.followers ?? 0,
          followingCount: c?.following ?? 0,
        });
      })
      .filter((m): m is Member => Boolean(m));
  } catch (err) {
    console.error("[members] DB load failed", err);
    return [];
  }
}

/**
 * Whether prototype seed members from `src/data/members.ts` appear in public
 * Explore / search / profile routes. Off by default so production only shows
 * real accounts. Set SHOW_SEED_MEMBERS=1 for local demos.
 */
export function showSeedMembersInPublicDirectory(): boolean {
  return (
    process.env.SHOW_SEED_MEMBERS === "1" ||
    process.env.SHOW_SEED_MEMBERS === "true"
  );
}

/** Merged directory: real onboarded accounts (+ optional local seed prototypes). */
export async function getAllMembers(): Promise<Member[]> {
  const db = await loadDbMembers();
  if (!showSeedMembersInPublicDirectory()) {
    return db;
  }
  const seed = seedMembers.map(withSeedDefaults);
  const seedIds = new Set(seed.map((m) => m.id));
  const seedUsernames = new Set(seed.map((m) => m.username.toLowerCase()));
  const extras = db.filter(
    (m) => !seedIds.has(m.id) && !seedUsernames.has(m.username.toLowerCase()),
  );
  return [...seed, ...extras];
}

async function memberFromFullUser(
  user: DbUserBundle,
): Promise<Member | null> {
  const [followers, following] = await Promise.all([
    prisma.follow.count({
      where: { followingId: user.id, followingIsSeed: false },
    }),
    prisma.follow.count({ where: { followerId: user.id } }),
  ]);
  return dbUserToMember({
    ...user,
    followerCount: followers,
    followingCount: following,
  });
}

export async function getMemberBySlugAsync(slug: string): Promise<Member | null> {
  if (showSeedMembersInPublicDirectory()) {
    const seed = getSeedBySlug(slug);
    if (seed) return withSeedDefaults(seed);
  }

  try {
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ slug }, { username: slug }],
        // Public lookups never surface admins, test fixtures, deleted, or
        // opted-out accounts — see src/lib/discoverability.ts.
        ...publicMemberWhere,
      },
      include: userIncludeFull,
    });
    if (!user) return null;
    return memberFromFullUser(user as DbUserBundle);
  } catch (err) {
    console.error("[members] slug lookup failed", err);
    return null;
  }
}

/** Self-service only — see selfViewableWhere. Do not use for public lookups. */
export async function getMemberByIdAsync(id: string): Promise<Member | null> {
  if (showSeedMembersInPublicDirectory()) {
    const seed = seedMembers.find((m) => m.id === id);
    if (seed) return withSeedDefaults(seed);
  }
  try {
    const user = await prisma.user.findFirst({
      where: {
        id,
        ...selfViewableWhere,
      },
      include: userIncludeFull,
    });
    if (!user) return null;
    return memberFromFullUser(user as DbUserBundle);
  } catch {
    return null;
  }
}

export async function getMemberByUsernameAsync(
  username: string,
): Promise<Member | null> {
  const handle = username.replace(/^@/, "").toLowerCase();
  if (showSeedMembersInPublicDirectory()) {
    const seed = seedMembers.find((m) => m.username.toLowerCase() === handle);
    if (seed) return withSeedDefaults(seed);
  }
  try {
    const user = await prisma.user.findFirst({
      where: {
        ...publicMemberWhere,
        username: handle,
      },
      include: userIncludeFull,
    });
    if (!user) return null;
    return dbUserToMember(user as DbUserBundle);
  } catch {
    return null;
  }
}

export async function isUsernameAvailable(
  username: string,
  excludeUserId?: string,
): Promise<boolean> {
  const handle = username.replace(/^@/, "").toLowerCase();
  if (seedMembers.some((m) => m.username.toLowerCase() === handle)) {
    return false;
  }
  const existing = await prisma.user.findFirst({
    where: {
      username: handle,
      ...(excludeUserId ? { NOT: { id: excludeUserId } } : {}),
    },
    select: { id: true },
  });
  return !existing;
}

function feedFromMembers(members: Member[], limit: number): FeedItem[] {
  // Live Activity must only show real, active accounts — never seed prototypes
  // and never soft-deleted / anonymized users.
  const fromDb: FeedItem[] = [];
  for (const m of members.filter(
    (m) =>
      m.isRealAccount &&
      !m.isPrototype &&
      Boolean(m.username) &&
      Boolean(m.slug),
  )) {
    if (isStatusActive(m.status) && m.status) {
      fromDb.push({
        id: `status-${m.id}-${m.status.postedAt}`,
        kind: "status",
        memberId: m.id,
        memberSlug: m.slug,
        username: m.username,
        fullName: m.fullName,
        photo: m.photo,
        text: m.status.text,
        postedAt: m.status.postedAt,
        expiresAt: m.status.expiresAt,
      });
    }
    for (const o of m.opportunities ?? []) {
      if (o.closedAt) continue;
      if (o.expiresAt && Date.parse(o.expiresAt) <= Date.now()) continue;
      fromDb.push({
        id: `opp-${o.id}`,
        kind: "opportunity",
        memberId: m.id,
        memberSlug: m.slug,
        username: m.username,
        fullName: m.fullName,
        photo: m.photo,
        text: o.description || o.title || o.summary,
        city: o.city,
        country: o.country,
        postedAt: o.postedAt,
        startsAt: o.startsAt ?? undefined,
        expiresAt: o.expiresAt ?? undefined,
      });
    }
  }
  return fromDb
    .sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt))
    .slice(0, limit);
}

async function feedFromDbQueries(limit: number): Promise<FeedItem[]> {
  const now = new Date();
  const userSelect = {
    id: true,
    slug: true,
    username: true,
    name: true,
    photo: true,
  } as const;

  try {
    const [statuses, opportunities] = await Promise.all([
      prisma.statusUpdate.findMany({
        where: {
          expiresAt: { gt: now },
          user: publicMemberWhere,
        },
        orderBy: { postedAt: "desc" },
        take: limit,
        select: {
          text: true,
          postedAt: true,
          expiresAt: true,
          user: { select: userSelect },
        },
      }),
      prisma.opportunity.findMany({
        where: {
          closedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          user: publicMemberWhere,
        },
        orderBy: { postedAt: "desc" },
        take: limit,
        select: {
          id: true,
          title: true,
          description: true,
          city: true,
          country: true,
          postedAt: true,
          startsAt: true,
          expiresAt: true,
          user: { select: userSelect },
        },
      }),
    ]);

    const fromDb: FeedItem[] = [];
    for (const s of statuses) {
      const u = s.user;
      if (!u.slug || !u.username) continue;
      fromDb.push({
        id: `status-${u.id}-${s.postedAt.toISOString()}`,
        kind: "status",
        memberId: u.id,
        memberSlug: u.slug,
        username: u.username,
        fullName: u.name,
        photo: memberPhoto(u.photo),
        text: s.text,
        postedAt: s.postedAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
      });
    }
    for (const o of opportunities) {
      const u = o.user;
      if (!u.slug || !u.username) continue;
      fromDb.push({
        id: `opp-${o.id}`,
        kind: "opportunity",
        memberId: u.id,
        memberSlug: u.slug,
        username: u.username,
        fullName: u.name,
        photo: memberPhoto(u.photo),
        text: o.description || o.title,
        city: o.city,
        country: o.country,
        postedAt: o.postedAt.toISOString(),
        startsAt: o.startsAt?.toISOString() ?? undefined,
        expiresAt: o.expiresAt?.toISOString() ?? undefined,
      });
    }

    // Real DB activity only — seed prototypes must never appear in Live Activity.
    return fromDb
      .sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt))
      .slice(0, limit);
  } catch (err) {
    console.error("[members] feed query failed", err);
    return [];
  }
}

/**
 * Live activity feed. Pass `members` when already loaded (e.g. Explore)
 * to avoid a second directory fetch; otherwise queries statuses/opportunities directly.
 */
export async function buildMergedLiveFeed(
  limit = 40,
  members?: Member[],
): Promise<FeedItem[]> {
  if (members) return feedFromMembers(members, limit);
  return feedFromDbQueries(limit);
}

const DIRECTORY_INCLUDE = {
  networkLocations: { orderBy: { sortOrder: "asc" as const }, take: 1 },
} as const;

export const DIRECTORY_PAGE_SIZE_MOBILE = 24;
export const DIRECTORY_PAGE_SIZE_DESKTOP = 36;

/**
 * Server-side Explore directory page. Compact payload — no listings/reviews.
 * Search is DB-side (username, name, location, display message) so we never
 * hide-all on the client or reset the full Explore document.
 */
export async function listDirectoryMembersPage(opts: {
  q?: string;
  page?: number;
  limit?: number;
}): Promise<{
  members: Member[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}> {
  const page = Math.max(1, Math.floor(opts.page || 1));
  const limit = Math.min(
    Math.max(Math.floor(opts.limit || DIRECTORY_PAGE_SIZE_MOBILE), 6),
    48,
  );
  const q = (opts.q || "").trim();
  const skip = (page - 1) * limit;
  const handleNorm = normalizeSearchHandle(q);
  const qNoAt = q.replace(/^@+/, "").trim();

  const searchWhere = q
    ? {
        OR: [
          { username: { contains: qNoAt, mode: "insensitive" as const } },
          { name: { contains: q, mode: "insensitive" as const } },
          { city: { contains: q, mode: "insensitive" as const } },
          { country: { contains: q, mode: "insensitive" as const } },
          {
            publicDisplayMessage: {
              contains: q,
              mode: "insensitive" as const,
            },
          },
          {
            networkLocations: {
              some: {
                OR: [
                  { city: { contains: q, mode: "insensitive" as const } },
                  { country: { contains: q, mode: "insensitive" as const } },
                ],
              },
            },
          },
          ...(handleNorm.length >= 2
            ? [
                {
                  username: {
                    contains: handleNorm,
                    mode: "insensitive" as const,
                  },
                },
              ]
            : []),
        ],
      }
    : {};

  try {
    const where = { ...publicMemberWhere, ...searchWhere };
    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        include: DIRECTORY_INCLUDE,
        orderBy: [{ username: "asc" }],
        skip,
        take: limit,
      }),
    ]);
    const members = users
      .map((u) => dbUserToMember(u as DbUserBundle))
      .filter((m): m is Member => Boolean(m));
    return {
      members,
      page,
      limit,
      total,
      hasMore: skip + members.length < total,
    };
  } catch (err) {
    console.error("[members] directory page failed", err);
    return { members: [], page, limit, total: 0, hasMore: false };
  }
}

/** Public-safe user profile payload (no email). */
export function toPublicMemberJson(member: Member) {
  return {
    id: member.id,
    slug: member.slug,
    username: member.username,
    fullName: member.fullName,
    photo: member.photo,
    cover: member.cover,
    location: member.location,
    publicDisplayMessage: member.publicDisplayMessage || "",
    bio: member.bio,
    identityVerified: member.verification.identityVerified,
    network: member.network,
    trips: member.trips,
    status: isStatusActive(member.status) ? member.status : null,
    opportunity: member.opportunity,
    opportunities: member.opportunities ?? [],
    reviews: member.reviews,
    listingIds: member.listingIds,
    followerCount: member.followerCount ?? 0,
    followingCount: member.followingCount ?? 0,
    isPrototype: Boolean(member.isPrototype),
    joinedAt: member.joinedAt,
    services: member.services,
  };
}
