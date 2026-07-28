"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { FeedItem, Member } from "@/lib/types";
import { searchMembers } from "@/lib/search-members";
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

export function ExploreClient({
  initialMembers,
  initialFeed,
}: ExploreClientProps) {
  const searchParams = useSearchParams();
  const initialQ = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(initialQ);

  const results = useMemo(
    () => searchMembers(query, initialMembers),
    [query, initialMembers],
  );

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
              <LiveFeed items={initialFeed.slice(0, FEED_PREVIEW_LIMIT)} />
            </div>
          </div>
        </section>

        <section className="mt-14 sm:mt-16">
          <div className="mb-6 flex items-baseline justify-between gap-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
              People
            </h2>
            <p className="text-sm text-white/40">
              {results.length} member{results.length === 1 ? "" : "s"}
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 sm:gap-6 xl:grid-cols-3">
            {results.map((member) => (
              <MemberCard key={member.id} member={member} />
            ))}
          </div>

          {!results.length ? (
            <p className="mt-16 text-center text-white/50">
              No members match this search. Try a place, product, or username.
            </p>
          ) : null}
        </section>
      </Container>
    </div>
  );
}
