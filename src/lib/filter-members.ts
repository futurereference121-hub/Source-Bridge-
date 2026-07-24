import type { ExploreFilters, Member } from "@/lib/types";

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

export function filterMembers(
  members: Member[],
  filters: ExploreFilters,
): Member[] {
  const q = filters.query.trim().toLowerCase();

  return members.filter((member) => {
    if (filters.country && member.location.country !== filters.country) {
      const connected = member.connectedCountries.some(
        (c) => c.country === filters.country,
      );
      if (!connected) return false;
    }

    if (filters.city && member.location.city !== filters.city) return false;

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

    if (!q) return true;

    const haystack = [
      member.fullName,
      member.howICanHelp,
      member.bio,
      member.location.label,
      member.location.city,
      member.location.country,
      member.memberType,
      member.availabilityLabel,
      ...member.services.map((s) => s.label),
      ...member.connectedCountries.map((c) => c.country),
      ...member.languages,
      member.upcomingJourney
        ? `${member.upcomingJourney.from} ${member.upcomingJourney.to}`
        : "",
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(q);
  });
}
