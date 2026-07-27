"use client";

import { Search } from "lucide-react";

type SearchBarProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
  variant?: "light" | "dark";
};

export function SearchBar({
  value,
  onChange,
  placeholder = "Search by place, product, journey or opportunity...",
  onSubmit,
  variant = "light",
}: SearchBarProps) {
  const dark = variant === "dark";

  return (
    <form
      className="relative"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
    >
      <Search
        size={22}
        strokeWidth={1.5}
        className={`pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 sm:left-6 ${
          dark ? "text-white/40" : "text-muted"
        }`}
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={
          dark
            ? "h-16 w-full rounded-xl border border-white/12 bg-white/[0.05] pl-14 pr-5 text-base text-white shadow-[0_0_40px_rgba(59,130,246,0.08)] outline-none transition-[border-color,box-shadow] placeholder:text-white/35 focus:border-electric/50 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.18),0_0_40px_rgba(59,130,246,0.12)] sm:h-[76px] sm:pl-16 sm:pr-6 sm:text-lg"
            : "h-16 w-full rounded-[5px] border border-border bg-surface pl-14 pr-5 text-base text-ink shadow-sm outline-none transition-colors placeholder:text-muted-light focus:border-electric/50 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.12)] sm:h-[72px] sm:text-lg"
        }
        aria-label="Search members"
      />
    </form>
  );
}
