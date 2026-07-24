"use client";

import type { ExploreFilters } from "@/lib/types";
import { memberTypeLabels } from "@/lib/site";

type FilterPanelProps = {
  filters: ExploreFilters;
  onChange: (next: ExploreFilters) => void;
  countries: string[];
  cities: string[];
  services: string[];
  memberTypes: string[];
};

export function FilterPanel({
  filters,
  onChange,
  countries,
  cities,
  services,
  memberTypes,
}: FilterPanelProps) {
  const set = <K extends keyof ExploreFilters>(key: K, value: ExploreFilters[K]) => {
    onChange({ ...filters, [key]: value });
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      <label className="block text-xs uppercase tracking-[0.14em] text-muted">
        Country
        <select
          className="mt-1.5 h-11 w-full border border-border bg-surface px-3 text-sm text-ink outline-none focus:border-ink/40"
          value={filters.country}
          onChange={(e) => set("country", e.target.value)}
        >
          <option value="">All</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-xs uppercase tracking-[0.14em] text-muted">
        City
        <select
          className="mt-1.5 h-11 w-full border border-border bg-surface px-3 text-sm text-ink outline-none focus:border-ink/40"
          value={filters.city}
          onChange={(e) => set("city", e.target.value)}
        >
          <option value="">All</option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-xs uppercase tracking-[0.14em] text-muted">
        Service
        <select
          className="mt-1.5 h-11 w-full border border-border bg-surface px-3 text-sm text-ink outline-none focus:border-ink/40"
          value={filters.service}
          onChange={(e) => set("service", e.target.value)}
        >
          <option value="">All</option>
          {services.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-xs uppercase tracking-[0.14em] text-muted">
        Member type
        <select
          className="mt-1.5 h-11 w-full border border-border bg-surface px-3 text-sm text-ink outline-none focus:border-ink/40"
          value={filters.memberType}
          onChange={(e) => set("memberType", e.target.value)}
        >
          <option value="">All</option>
          {memberTypes.map((t) => (
            <option key={t} value={t}>
              {memberTypeLabels[t] ?? t}
            </option>
          ))}
        </select>
      </label>

      <label className="flex h-11 items-center gap-2 self-end border border-border bg-surface px-3 text-sm text-ink">
        <input
          type="checkbox"
          checked={filters.verifiedOnly}
          onChange={(e) => set("verifiedOnly", e.target.checked)}
          className="accent-accent"
        />
        Verified only
      </label>

      <label className="flex h-11 items-center gap-2 self-end border border-border bg-surface px-3 text-sm text-ink">
        <input
          type="checkbox"
          checked={filters.availableNow}
          onChange={(e) => set("availableNow", e.target.checked)}
          className="accent-accent"
        />
        Available now
      </label>

      <label className="flex h-11 items-center gap-2 self-end border border-border bg-surface px-3 text-sm text-ink">
        <input
          type="checkbox"
          checked={filters.travellingSoon}
          onChange={(e) => set("travellingSoon", e.target.checked)}
          className="accent-accent"
        />
        Travelling soon
      </label>
    </div>
  );
}
