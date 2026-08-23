"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { Member } from "@/lib/types";
import { SearchBar } from "@/components/search/SearchBar";
import { MemberDirectoryCard } from "@/components/members/MemberCard";
import { Container } from "@/components/ui/Container";
import { useStoriesOptional } from "@/components/stories/StoryProvider";

type SearchClientProps = {
  initialMembers: Member[];
  initialTotal: number;
  initialHasMore: boolean;
  initialQuery?: string;
};

function mapApiMember(raw: Record<string, unknown>): Member | null {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" ? raw.id : "";
  const username = typeof raw.username === "string" ? raw.username : "";
  const slug = typeof raw.slug === "string" ? raw.slug : "";
  if (!id || !username || !slug) return null;
  return raw as unknown as Member;
}

function directoryLimit(): number {
  if (typeof window === "undefined") return 24;
  return window.matchMedia("(min-width: 768px)").matches ? 36 : 24;
}

/**
 * Dedicated Search view — live results under the field (not Explore mid-page).
 */
export function SearchClient({
  initialMembers,
  initialTotal,
  initialHasMore,
  initialQuery = "",
}: SearchClientProps) {
  const searchParams = useSearchParams();
  const stories = useStoriesOptional();
  const urlQ = searchParams.get("q") ?? initialQuery;
  const [query, setQuery] = useState(urlQ);
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [total, setTotal] = useState(initialTotal);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryRef = useRef(query);
  queryRef.current = query;
  const requestSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const inputWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const ids = members.map((m) => m.id);
    if (ids.length) void stories?.refreshRings(ids);
  }, [members, stories?.refreshRings]);

  const fetchMembersPage = useCallback(
    async (opts: { q: string; page: number; append: boolean }) => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      const seq = ++requestSeq.current;
      if (opts.append) setLoadingMore(true);
      else setSearching(true);
      setError(null);
      try {
        const pageLimit = directoryLimit();
        const res = await fetch(
          `/api/members?q=${encodeURIComponent(opts.q)}&page=${opts.page}&limit=${pageLimit}`,
          { cache: "no-store", signal: ac.signal },
        );
        if (!res.ok) throw new Error("Could not refresh search results");
        const data = (await res.json()) as {
          members?: Record<string, unknown>[];
          total?: number;
          hasMore?: boolean;
          page?: number;
        };
        // Stale-query protection: ignore older responses.
        if (seq !== requestSeq.current) return;
        if (opts.q !== queryRef.current) return;
        const nextMembers = (data.members || [])
          .map(mapApiMember)
          .filter((m): m is Member => Boolean(m));
        setMembers((prev) =>
          opts.append
            ? [
                ...prev,
                ...nextMembers.filter((m) => !prev.some((p) => p.id === m.id)),
              ]
            : nextMembers,
        );
        setPage(data.page || opts.page);
        setHasMore(Boolean(data.hasMore));
        setTotal(
          typeof data.total === "number" ? data.total : nextMembers.length,
        );
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        if (seq !== requestSeq.current) return;
        setError(
          err instanceof Error ? err.message : "Connection lost. Please retry.",
        );
      } finally {
        if (seq === requestSeq.current) {
          setSearching(false);
          setLoadingMore(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    const handle = window.setTimeout(
      () => {
        void fetchMembersPage({ q: query, page: 1, append: false });
      },
      query === urlQ && !query ? 0 : 280,
    );
    return () => window.clearTimeout(handle);
  }, [query, urlQ, fetchMembersPage]);

  useEffect(() => {
    inputWrapRef.current?.querySelector("input")?.focus();
  }, []);

  return (
    <div
      className="bg-app-navy min-h-[100svh] pt-24 pb-24 text-white sm:pt-28 sm:pb-28"
      data-testid="dedicated-search"
    >
      <Container>
        <header className="mx-auto max-w-3xl">
          <h1 className="font-display text-2xl tracking-tight text-white sm:text-3xl">
            Search
          </h1>
          <p className="mt-2 text-sm text-white/55">
            Find people by handle, name, place, or public message.
          </p>
        </header>

        <div className="mx-auto mt-6 max-w-3xl" ref={inputWrapRef}>
          <SearchBar
            value={query}
            onChange={setQuery}
            variant="dark"
            enableAutocomplete={false}
            placeholder="Search @handle, name, city, or message…"
          />
          {error ? (
            <p className="mt-2 text-center text-xs text-red-300">{error}</p>
          ) : null}
        </div>

        <section
          className="mx-auto mt-4 max-w-3xl"
          aria-live="polite"
          data-testid="search-live-results"
        >
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
              Results
            </h2>
            <p className="text-sm text-white/40">
              {searching
                ? "Searching…"
                : query.trim()
                  ? `${total} result${total === 1 ? "" : "s"}`
                  : `${total} member${total === 1 ? "" : "s"}`}
            </p>
          </div>

          {query.trim().length > 0 && members.length > 0 ? (
            <ul className="mb-4 divide-y divide-white/10 rounded-xl border border-white/10 bg-white/[0.03]">
              {members.slice(0, 8).map((member) => (
                <li key={`live-${member.id}`}>
                  <a
                    href={`/u/${member.slug}`}
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-white/[0.04]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={member.photo || "/placeholders/avatar.svg"}
                      alt=""
                      className="h-9 w-9 rounded-full object-cover"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">
                        @{member.username}
                      </p>
                      <p className="truncate text-xs text-white/45">
                        {member.fullName || "Member"}
                      </p>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
            {members.map((member) => (
              <MemberDirectoryCard key={member.id} member={member} />
            ))}
          </div>

          {!members.length && !searching ? (
            <p className="mt-12 text-center text-white/50">
              {query.trim()
                ? "No members match this search."
                : "Start typing to search members."}
            </p>
          ) : null}

          {hasMore ? (
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                disabled={loadingMore || searching}
                onClick={() =>
                  void fetchMembersPage({
                    q: queryRef.current,
                    page: page + 1,
                    append: true,
                  })
                }
                className="rounded-lg border border-white/20 px-4 py-2 text-xs uppercase tracking-[0.12em] text-white/70 hover:border-white/40 disabled:opacity-50"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          ) : null}
        </section>
      </Container>
    </div>
  );
}
