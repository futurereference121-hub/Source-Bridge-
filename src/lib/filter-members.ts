import type { ExploreFilters, Listing, Member } from "@/lib/types";
import { searchMembers } from "@/lib/search-members";
import { products } from "@/data/products";

export const emptyExploreFilters: ExploreFilters = {
  query: "",
  country: "",
  city: "",
  service: "",
  memberType: "",
  verifiedOnly: false,
  availableNow: false,
  travellingSoon: false,
};

/**
 * Filter + search members. Query matching delegates to searchMembers
 * so semantic AI can replace the matcher later.
 */
export function filterMembers(
  members: Member[],
  filters: ExploreFilters,
  listings: Listing[] = products,
): Member[] {
  const results = searchMembers(filters.query, members, listings);

  return results.filter((member) => {
    if (filters.country && member.location.country !== filters.country) {
      const connected =
        member.connectedCountries.some((c) => c.country === filters.country) ||
        member.network.some((n) => n.country === filters.country);
      if (!connected) return false;
    }

    if (filters.city) {
      const inCity =
        member.location.city === filters.city ||
        member.network.some((n) => n.city === filters.city) ||
        member.trips.some((t) => t.city === filters.city);
      if (!inCity) return false;
    }

    if (filters.service) {
      const hasService = member.services.some(
        (s) => s.label === filters.service,
      );
      if (!hasService) return false;
    }

    if (filters.memberType && member.memberType !== filters.memberType) {
      return false;
    }

    if (filters.verifiedOnly && !member.verification.identityVerified) {
      return false;
    }

    if (filters.availableNow && member.availability !== "available_now") {
      return false;
    }

    if (filters.travellingSoon && member.availability !== "travelling_soon") {
      return false;
    }

    return true;
  });
}
