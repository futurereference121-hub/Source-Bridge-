"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { FeedItem, Member } from "@/lib/types";
import { SearchBar } from "@/components/search/SearchBar";
import { LiveFeed } from "@/components/explore/LiveFeed";
import { MemberCard } from "@/components/members/MemberCard";
import { Container } from "@/components/ui/Container";

const SEARCH_EXAMPLES =
  "Japan · Coffee from Colombia · Someone travelling to Bangkok · Watches in Switzerland";

const FEED_PREVIEW_LIMIT = 8;

type ExploreClientProps = {
  initialMembers: Member[];
  initialFeed: FeedItem[];
};

function mapApiMember(raw: Record<string, unknown>): Member | null {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" ? raw.id : "";
  const username = typeof raw.username === "string" ? raw.username : "";
  const slug = typeof raw.slug === "string" ? raw.slug : "";
  if (!id || !username || !slug) return null;
  return raw as unknown as Member;
}

export function ExploreClient({
  initialMembers,
  initialFeed,
}: ExploreClientProps) {
  const searchParams = useSearchParams();
  const initialQ = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(initialQ);
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [feed, setFeed] = useState<FeedItem[]>(initialFeed);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryRef = useRef(query);
  queryRef.current = query;

  const refreshDirectory = useCallback(async (q: string) => {
    setSearching(true);
    setError(null);
    try {
      const [membersRes, feedRes] = await Promise.all([
        fetch(`/api/members?q=${encodeURIComponent(q)}`, { cache: "no-store" }),
        fetch("/api/feed?limit=8", { cache: "no-store" }),
      ]);
      if (!membersRes.ok) {
        throw new Error("Could not refresh member directory");
      }
      const membersData = (await membersRes.json()) as {
        members?: Record<string, unknown>[];
      };
      const nextMembers = (membersData.members || [])
        .map(mapApiMember)
        .filter((m): m is Member => Boolean(m));
      setMembers(nextMembers);

      if (feedRes.ok) {
        const feedData = (await feedRes.json()) as { items?: FeedItem[] };
        if (Array.isArray(feedData.items)) setFeed(feedData.items);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Connection lost. Please retry.",
      );
    } finally {
      setSearching(false);
    }
  }, []);

  // Initial server refresh + debounced search. Always hits the API — never
  // filters only the SSR snapshot so new accounts appear immediately.
  useEffect(() => {
    const handle = window.setTimeout(
      () => {
        void refreshDirectory(query);
      },
      query === initialQ ? 0 : 280,
    );
    return () => window.clearTimeout(handle);
  }, [query, initialQ, refreshDirectory]);

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") {
        void refreshDirectory(queryRef.current);
      }
    }
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshDirectory]);

  return (
    <div className="bg-app-navy min-h-[100svh] pt-24 pb-24 text-white sm:pt-28 sm:pb-28">
      <Container>
        <header className="mx-auto max-w-3xl text-center">
          <h1 className="font-display text-[1.65rem] leading-snug tracking-tight text-white sm:text-4xl sm:leading-tight md:text-[2.5rem]">
            What do you need—and where in the world can it be found?
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-white/60 sm:mt-5 sm:text-base">
            Discover trusted people already connected to the places, products
            and opportunities you are looking for.
          </p>
        </header>

        <div className="mx-auto mt-10 max-w-3xl sm:mt-12">
          <SearchBar
            value={query}
            onChange={setQuery}
            variant="dark"
            placeholder="Search by place, product, journey or opportunity..."
          />
          <p className="mt-3 text-center text-xs leading-relaxed text-white/35 sm:text-[13px]">
            {SEARCH_EXAMPLES}
          </p>
          {error ? (
            <p className="mt-2 text-center text-xs text-red-300">{error}</p>
          ) : null}
        </div>

        <section className="mx-auto mt-12 max-w-2xl sm:mt-14">
          <div className="panel-navy rounded-xl px-4 py-4 sm:px-5 sm:py-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">
                Live Activity
              </h2>
              <Link
                href="/activity"
                className="text-[11px] font-medium uppercase tracking-[0.14em] text-electric/80 transition-colors hover:text-electric"
              >
                View All Activity
              </Link>
            </div>
            <div className="mt-3">
              <LiveFeed items={feed.slice(0, FEED_PREVIEW_LIMIT)} />
            </div>
          </div>
        </section>

        <section className="mt-14 sm:mt-16">
          <div className="mb-6 flex items-baseline justify-between gap-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
              People
            </h2>
            <p className="text-sm text-white/40">
              {searching
                ? "Updating…"
                : `${members.length} member${members.length === 1 ? "" : "s"}`}
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
            {members.map((member) => (
              <MemberCard key={member.id} member={member} />
            ))}
          </div>

          {!members.length && !searching ? (
            <p className="mt-16 text-center text-white/50">
              No members match this search. Try a place, product, or username.
            </p>
          ) : null}
        </section>
      </Container>
    </div>
  );
}
