"use client";

import { Search } from "lucide-react";

type SearchBarProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
};

export function SearchBar({
  value,
  onChange,
  placeholder = "Search a country, city, product, service or member",
  onSubmit,
}: SearchBarProps) {
  return (
    <form
      className="relative"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
    >
      <Search
        size={20}
        strokeWidth={1.5}
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted"
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-14 w-full border border-border bg-surface pl-12 pr-4 text-base text-ink outline-none transition-colors placeholder:text-muted-light focus:border-ink/40"
        aria-label="Search members"
      />
    </form>
  );
}
