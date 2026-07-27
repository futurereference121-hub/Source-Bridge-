import type { Listing, Member } from "@/lib/types";
import { products } from "@/data/products";
import { isStatusActive } from "@/lib/member-status";

/**
 * Tokenized member search. Designed so a semantic AI matcher
 * can replace this function later without changing call sites.
 *
 * Natural queries e.g. "Watches in Japan", "Leather Morocco",
 * "Someone travelling to Bangkok", "Coffee Colombia".
 */
export function searchMembers(
  query: string,
  members: Member[],
  listings: Listing[] = products,
): Member[] {
  const q = query.trim().toLowerCase();
  if (!q) return members;

  const tokens = tokenize(q);
  if (!tokens.length) return members;

  return members.filter((member) => {
    const haystack = buildSearchHaystack(member, listings);
    return tokens.every((token) => haystack.includes(token));
  });
}

/** Split query into searchable tokens; drop filler words. */
export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9@]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

const STOP_WORDS = new Set([
  "in",
  "from",
  "to",
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "for",
  "with",
  "someone",
  "looking",
  "find",
  "near",
  "at",
]);

function buildSearchHaystack(member: Member, listings: Listing[]): string {
  const memberListings = listings.filter(
    (l) => l.memberId === member.id || member.listingIds.includes(l.id),
  );

  const statusActive = isStatusActive(member.status);

  const parts: string[] = [
    member.username,
    `@${member.username}`,
    member.fullName,
    member.howICanHelp,
    member.publicDisplayMessage ?? "",
    member.bio,
    member.location.city,
    member.location.country,
    member.location.label,
    member.location.cityCode ?? "",
    member.location.countryCode ?? "",
    member.memberType,
    member.availabilityLabel,
    member.availability,
    ...member.services.map((s) => s.label),
    ...member.languages,
    ...member.network.flatMap((n) => [
      n.city,
      n.country,
      n.cityCode ?? "",
      n.countryCode ?? "",
    ]),
    ...member.trips.flatMap((t) => [t.city, t.country, t.dateRange]),
    ...member.connectedCountries.map((c) => c.country),
    ...memberListings.flatMap((l) => [
      l.name,
      l.category,
      l.subcategory ?? "",
      l.country,
      l.currentLocation,
      ...l.tags,
    ]),
  ];

  if (statusActive && member.status) {
    parts.push(member.status.text);
  }

  if (member.opportunity) {
    const o = member.opportunity;
    parts.push(
      o.summary,
      o.availability ?? "",
      o.travel ?? "",
      o.localAccess ?? "",
      o.stock ?? "",
      o.city,
      o.country,
      o.cityCode ?? "",
      o.countryCode ?? "",
      ...o.categories,
    );
  }

  for (const journey of member.journeys) {
    parts.push(journey.from, journey.to, journey.datesLabel, journey.note ?? "");
  }

  return parts.join(" ").toLowerCase();
}
