"use client";

import { useMemo, useState } from "react";
import type { Listing } from "@/lib/types";
import { ListingCard } from "@/components/marketplace/ListingCard";
import { getSubcategoriesForCategory, getUniqueCategories } from "@/data/products";

type MarketplaceCatalogueProps = {
  listings: Listing[];
  initialCategory?: string;
  initialSubcategory?: string;
};

export function MarketplaceCatalogue({
  listings,
  initialCategory = "",
  initialSubcategory = "",
}: MarketplaceCatalogueProps) {
  const categories = getUniqueCategories();
  const [category, setCategory] = useState(initialCategory);
  const [subcategory, setSubcategory] = useState(initialSubcategory);

  const subcategories = useMemo(
    () => (category ? getSubcategoriesForCategory(category) : []),
    [category],
  );

  const filtered = useMemo(() => {
    return listings.filter((p) => {
      if (category && p.category !== category) return false;
      if (subcategory && p.subcategory !== subcategory) return false;
      return true;
    });
  }, [listings, category, subcategory]);

  return (
    <div className="grid gap-10 lg:grid-cols-[240px_1fr] lg:gap-14">
      <aside className="space-y-8">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
            Category
          </p>
          <div className="mt-4 flex flex-wrap gap-2 lg:flex-col lg:gap-1">
            <FilterChip
              label="All"
              active={!category}
              onClick={() => {
                setCategory("");
                setSubcategory("");
              }}
            />
            {categories.map((c) => (
              <FilterChip
                key={c}
                label={c}
                active={category === c}
                onClick={() => {
                  setCategory(c);
                  setSubcategory("");
                }}
              />
            ))}
          </div>
        </div>

        {subcategories.length > 0 ? (
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">
              Subcategory
            </p>
            <div className="mt-4 flex flex-wrap gap-2 lg:flex-col lg:gap-1">
              <FilterChip
                label="All"
                active={!subcategory}
                onClick={() => setSubcategory("")}
              />
              {subcategories.map((s) => (
                <FilterChip
                  key={s}
                  label={s}
                  active={subcategory === s}
                  onClick={() => setSubcategory(s)}
                />
              ))}
            </div>
          </div>
        ) : null}
      </aside>

      <div>
        <p className="mb-6 text-sm text-muted">
          {filtered.length} finding{filtered.length === 1 ? "" : "s"}
          {category ? ` in ${category}` : ""}
          {subcategory ? ` · ${subcategory}` : ""}
        </p>
        {filtered.length === 0 ? (
          <p className="border border-border bg-surface p-10 text-center text-muted">
            No findings match this filter. Try another category.
          </p>
        ) : (
          <div className="grid gap-8 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((listing, index) => (
              <ListingCard
                key={listing.id}
                listing={listing}
                priority={index < 3}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 text-left text-sm transition-colors lg:w-full ${
        active
          ? "bg-ink text-white"
          : "bg-transparent text-muted hover:bg-stone hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}
