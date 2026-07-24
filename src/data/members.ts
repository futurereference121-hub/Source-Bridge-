import type { Member } from "@/lib/types";

/**
 * Launch seed: one active community member covering Thailand & Russia.
 * Equal member — no founder language in public UI.
 */
export const launchMember: Member = {
  id: "m-alex-rivera",
  slug: "alex-rivera",
  displayName: "Alex Rivera",
  photo:
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&q=80",
  cover:
    "https://images.unsplash.com/photo-1552465011-b4e21bf6e79a?w=1600&q=80",
  bio: "Based between Bangkok and Moscow, Alex helps people access local makers, markets, and hard-to-find pieces — and shares discoveries from travel across Asia and Europe. Equal member of the Source Bridge community.",
  languages: ["English", "Thai", "Russian", "Spanish"],
  currentLocation: "Bangkok, Thailand",
  countries: ["Thailand", "Russia"],
  areasWillingToTravel: [
    "Southeast Asia",
    "East Asia",
    "Eastern Europe",
    "Spain & Latin America corridors",
  ],
  availability: "Open to sourcing requests · Reply within a few days",
  services: {
    canSource: true,
    canInspect: true,
    canNegotiate: true,
    canTranslate: true,
    canRecommendSuppliers: true,
    canReceiveDeliveries: true,
    canShipInternationally: true,
    canCarryWhileTravelling: true,
    hasLocalKnowledge: true,
  },
  bridgeScore: {
    score: 92,
    label: "Bridge Score",
    note: "Placeholder — scoring logic coming soon",
  },
  badges: [
    { kind: "verified_identity", label: "Verified Identity", placeholder: true },
    { kind: "trusted_member", label: "Trusted Member", placeholder: true },
    { kind: "specialist", label: "Specialist", placeholder: true },
    { kind: "traveller", label: "Traveller", placeholder: true },
    { kind: "top_rated", label: "Top Rated", placeholder: true },
  ],
  responseRate: 98,
  reviews: {
    averageRating: 4.9,
    totalReviews: 24,
    completedRequests: 47,
    note: "Placeholder stats — reviews coming soon",
  },
  upcomingJourneys: [
    {
      id: "j-1",
      from: "Bangkok",
      to: "Chiang Mai",
      datesLabel: "Aug 2026",
      note: "Local markets & artisan visits",
    },
    {
      id: "j-2",
      from: "Bangkok",
      to: "Tokyo",
      datesLabel: "Sep 2026",
      note: "Design district sourcing",
    },
    {
      id: "j-3",
      from: "Madrid",
      to: "Mexico City",
      datesLabel: "Oct 2026",
      note: "Cross-Atlantic corridor",
    },
    {
      id: "j-4",
      from: "Moscow",
      to: "Phuket",
      datesLabel: "Nov 2026",
      note: "Seasonal return to Thailand",
    },
  ],
  listingIds: [
    "p-001",
    "p-002",
    "p-003",
    "p-004",
    "p-005",
    "p-006",
    "p-007",
    "p-008",
    "p-009",
    "p-010",
    "p-011",
    "p-012",
    "p-013",
    "p-014",
    "p-015",
    "p-016",
    "p-017",
    "p-018",
    "p-019",
    "p-020",
    "p-021",
    "p-022",
  ],
  joinedAt: "2025-06-01",
};

export const members: Member[] = [launchMember];

export function getMemberById(id: string): Member | undefined {
  return members.find((m) => m.id === id);
}

export function getMemberBySlug(slug: string): Member | undefined {
  return members.find((m) => m.slug === slug);
}

/** Primary launch member for homepage teases and seed listings. */
export function getLaunchMember(): Member {
  return launchMember;
}
