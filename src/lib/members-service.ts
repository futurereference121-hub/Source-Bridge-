import { prisma } from "@/lib/db";
import { members as seedMembers, getMemberBySlug as getSeedBySlug } from "@/data/members";
import { dbUserToMember, type DbUserBundle } from "@/lib/member-map";
import type { Member } from "@/lib/types";
import { buildLiveFeed } from "@/lib/feed";
import type { FeedItem } from "@/lib/types";
import { isStatusActive } from "@/lib/member-status";

const userInclude = {
  networkLocations: { orderBy: { sortOrder: "asc" as const } },
  trips: { orderBy: { arrival: "asc" as const } },
  statuses: { orderBy: { postedAt: "desc" as const }, take: 5 },
  opportunities: { orderBy: { postedAt: "desc" as const }, take: 20 },
  listings: { orderBy: { createdAt: "desc" as const } },
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

async function loadDbMembers(): Promise<Member[]> {
  try {
    const users = await prisma.user.findMany({
      where: {
        emailVerified: true,
        onboardingComplete: true,
        username: { not: null },
        slug: { not: null },
      },
      include: userInclude,
    });
    const ids = users.map((u) => u.id);
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

    return users
      .map((u) =>
        dbUserToMember({
          ...(u as DbUserBundle),
          followerCount: followersMap.get(u.id) ?? 0,
          followingCount: followingMap.get(u.id) ?? 0,
        }),
      )
      .filter((m): m is Member => Boolean(m));
  } catch (err) {
    console.error("[members] DB load failed", err);
    return [];
  }
}

/** Merged directory: seed prototypes + real onboarded accounts. */
export async function getAllMembers(): Promise<Member[]> {
  const db = await loadDbMembers();
  const seed = seedMembers.map(withSeedDefaults);
  const seedIds = new Set(seed.map((m) => m.id));
  const seedUsernames = new Set(seed.map((m) => m.username.toLowerCase()));
  const extras = db.filter(
    (m) => !seedIds.has(m.id) && !seedUsernames.has(m.username.toLowerCase()),
  );
  return [...seed, ...extras];
}

export async function getMemberBySlugAsync(slug: string): Promise<Member | null> {
  const seed = getSeedBySlug(slug);
  if (seed) return withSeedDefaults(seed);

  try {
    const user = await prisma.user.findFirst({
      where: { OR: [{ slug }, { username: slug }] },
      include: userInclude,
    });
    if (!user) return null;
    const [followers, following] = await Promise.all([
      prisma.follow.count({
        where: { followingId: user.id, followingIsSeed: false },
      }),
      prisma.follow.count({ where: { followerId: user.id } }),
    ]);
    return dbUserToMember({
      ...(user as DbUserBundle),
      followerCount: followers,
      followingCount: following,
    });
  } catch (err) {
    console.error("[members] slug lookup failed", err);
    return null;
  }
}

export async function getMemberByIdAsync(id: string): Promise<Member | null> {
  const seed = seedMembers.find((m) => m.id === id);
  if (seed) return withSeedDefaults(seed);
  try {
    const user = await prisma.user.findUnique({
      where: { id },
      include: userInclude,
    });
    if (!user) return null;
    const [followers, following] = await Promise.all([
      prisma.follow.count({
        where: { followingId: user.id, followingIsSeed: false },
      }),
      prisma.follow.count({ where: { followerId: user.id } }),
    ]);
    return dbUserToMember({
      ...(user as DbUserBundle),
      followerCount: followers,
      followingCount: following,
    });
  } catch {
    return null;
  }
}

export async function getMemberByUsernameAsync(
  username: string,
): Promise<Member | null> {
  const handle = username.replace(/^@/, "").toLowerCase();
  const seed = seedMembers.find((m) => m.username.toLowerCase() === handle);
  if (seed) return withSeedDefaults(seed);
  try {
    const user = await prisma.user.findFirst({
      where: { username: handle },
      include: userInclude,
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

export async function buildMergedLiveFeed(limit = 40): Promise<FeedItem[]> {
  const all = await getAllMembers();
  const fromSeed = buildLiveFeed(all.filter((m) => m.isPrototype));

  // Real accounts: expand all active opportunities + status
  const fromDb: FeedItem[] = [];
  for (const m of all.filter((m) => m.isRealAccount)) {
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
        text: o.title || o.summary,
        postedAt: o.postedAt,
        expiresAt: o.expiresAt ?? undefined,
      });
    }
  }

  return [...fromSeed, ...fromDb]
    .sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt))
    .slice(0, limit);
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
