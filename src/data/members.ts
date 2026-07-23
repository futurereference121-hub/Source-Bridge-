import type { Member } from "@/lib/types";

/**
 * Launch seed: one featured founding member covering Thailand & Russia.
 * Future members will use the same Member / MemberProfile shape.
 */
export const foundingMember: Member = {
  id: "m-founding",
  slug: "source-bridge-founding-member",
  displayName: "Source Bridge Founding Member",
  bio: "The first trusted member on Source Bridge — rooted in Thailand and Russia, helping people access products, personal sourcing, and local expertise across borders. Location is our value; connection is our craft.",
  countries: ["Thailand", "Russia"],
  verified: true,
  offersPersonalSourcing: true,
  offersRetailListings: true,
  offersBusinessSourcing: true,
  worldwideShipping: true,
  avatar:
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&q=80",
  joinedAt: "2025-06-01",
};

export const members: Member[] = [foundingMember];

export function getMemberById(id: string): Member | undefined {
  return members.find((m) => m.id === id);
}

export function getMemberBySlug(slug: string): Member | undefined {
  return members.find((m) => m.slug === slug);
}

export function getFoundingMember(): Member {
  return foundingMember;
}
