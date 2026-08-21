"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";

type Suggestion = {
  id: string;
  username: string;
  slug: string;
  name?: string;
  photo?: string;
};

type SearchBarProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
  variant?: "light" | "dark";
  /** Desktop autocomplete dropdown (md+). */
  enableAutocomplete?: boolean;
};

export function SearchBar({
  value,
  onChange,
  placeholder = "Search by place, product, journey or opportunity...",
  onSubmit,
  variant = "light",
  enableAutocomplete = true,
}: SearchBarProps) {
  const dark = variant === "dark";
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!enableAutocomplete) return;
    if (timer.current) clearTimeout(timer.current);
    const q = value.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    timer.current = setTimeout(() => {
      void fetch(`/api/members?q=${encodeURIComponent(q)}&limit=6`, {
        cache: "no-store",
      })
        .then((r) => r.json())
        .then((j: { members?: Suggestion[] }) => {
          const rows = Array.isArray(j.members) ? j.members.slice(0, 6) : [];
          setSuggestions(rows);
          setOpen(rows.length > 0);
        })
        .catch(() => {
          setSuggestions([]);
          setOpen(false);
        });
    }, 220);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, enableAutocomplete]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="relative" ref={wrapRef}>
      <form
        className="relative"
        onSubmit={(e) => {
          e.preventDefault();
          setOpen(false);
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
          onFocus={() => {
            if (suggestions.length) setOpen(true);
          }}
          placeholder={placeholder}
          className={
            dark
              ? "h-16 w-full rounded-xl border border-white/12 bg-white/[0.05] pl-14 pr-5 text-base text-white shadow-[0_0_40px_rgba(59,130,246,0.08)] outline-none transition-[border-color,box-shadow] placeholder:text-white/35 focus:border-electric/50 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.18),0_0_40px_rgba(59,130,246,0.12)] sm:h-[76px] sm:pl-16 sm:pr-6 sm:text-lg"
              : "h-16 w-full rounded-[5px] border border-border bg-surface pl-14 pr-5 text-base text-ink shadow-sm outline-none transition-colors placeholder:text-muted-light focus:border-electric/50 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.12)] sm:h-[72px] sm:text-lg"
          }
          aria-label="Search members"
          aria-autocomplete="list"
          autoComplete="off"
        />
      </form>
      {enableAutocomplete && open && suggestions.length ? (
        <ul
          className="absolute left-0 right-0 z-40 mt-2 hidden max-h-80 overflow-auto rounded-xl border border-white/15 bg-[#07152c] py-1 shadow-xl md:block"
          role="listbox"
          data-testid="search-autocomplete"
        >
          {suggestions.map((m) => (
            <li key={m.id} role="option">
              <Link
                href={`/${m.slug || m.username}`}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-white/85 hover:bg-white/10"
                onClick={() => setOpen(false)}
              >
                <span className="font-medium">@{m.username}</span>
                {m.name ? (
                  <span className="truncate text-white/45">{m.name}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
