"use client";

import { useMemo, useState } from "react";
import {
  getAllCities,
  getAllCountries,
  getAllMemberTypes,
  getAllServices,
  members,
} from "@/data/members";
import { emptyExploreFilters, filterMembers } from "@/lib/filter-members";
import { SearchBar } from "@/components/search/SearchBar";
import { FilterPanel } from "@/components/search/FilterPanel";
import { MemberCard } from "@/components/members/MemberCard";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { useAppUi } from "@/components/providers/AppProviders";

export function ExploreClient() {
  const [filters, setFilters] = useState(emptyExploreFilters);
  const { saveCurrentSearch } = useAppUi();

  const countries = useMemo(() => getAllCountries(), []);
  const cities = useMemo(() => getAllCities(), []);
  const services = useMemo(() => getAllServices(), []);
  const memberTypes = useMemo(() => getAllMemberTypes(), []);

  const results = useMemo(() => filterMembers(members, filters), [filters]);

  const searchLabel = [
    filters.query && `"${filters.query}"`,
    filters.country,
    filters.city,
    filters.service,
    filters.memberType,
    filters.verifiedOnly && "verified",
    filters.availableNow && "available now",
    filters.travellingSoon && "travelling soon",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="pt-24 pb-20 sm:pt-28 sm:pb-24">
      <Container>
        <h1 className="font-display text-4xl text-ink sm:text-5xl">
          Who can help you, and where?
        </h1>
        <p className="mt-3 max-w-2xl text-base text-muted">
          Browse members by location, travel, and how they can help — people first.
        </p>

        <div className="mt-8 space-y-4">
          <SearchBar
            value={filters.query}
            onChange={(query) => setFilters((f) => ({ ...f, query }))}
          />
          <FilterPanel
            filters={filters}
            onChange={setFilters}
            countries={countries}
            cities={cities}
            services={services}
            memberTypes={memberTypes}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {results.length} member{results.length === 1 ? "" : "s"}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFilters(emptyExploreFilters)}
              >
                Clear filters
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => saveCurrentSearch(searchLabel || "All members")}
              >
                Save search
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-10 grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {results.map((member) => (
            <MemberCard key={member.id} member={member} />
          ))}
        </div>

        {!results.length ? (
          <p className="mt-16 text-center text-muted">
            No members match these filters. Try a broader search.
          </p>
        ) : null}
      </Container>
    </div>
  );
}
