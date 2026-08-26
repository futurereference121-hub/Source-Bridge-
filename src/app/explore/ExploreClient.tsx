"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { FeedItem, Member } from "@/lib/types";
import {
  maxFeedContentVersion,
  shouldApplyExploreFeedPayload,
} from "@/lib/explore-feed-activity";
import { SearchBar } from "@/components/search/SearchBar";
import { LiveFeedSplit } from "@/components/explore/LiveFeedSplit";
import { MemberDirectoryCard } from "@/components/members/MemberCard";
import { Container } from "@/components/ui/Container";
import { useStoriesOptional } from "@/components/stories/StoryProvider";

const SEARCH_EXAMPLES =
  "Japan · Coffee from Colombia · Someone travelling to Bangkok · Watches in Switzerland";

const FEED_PREVIEW_LIMIT = 8;
/** Match chat soft-poll cadence — version check only; full feed when changed. */
const EXPLORE_FEED_SOFT_POLL_MS = 2500;

type ExploreClientProps = {
  initialMembers: Member[];
  initialFeed: FeedItem[];
  initialTotal: number;
  initialHasMore: boolean;
  initialLimit: number;
  /** Dedicated Search tab — focus search UX first. */
  searchFirst?: boolean;
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
  return window.matchMedia("((min-width: 768px))").matches ? 36 : 24;
}

function feedItemsEqual(a: FeedItem[], b: FeedItem[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (item, i) => item.id === b[i]?.id && item.text === b[i]?.text,
  );
}

export function ExploreClient({
  initialMembers,
  initialFeed,
  initialTotal,
  initialHasMore,
  initialLimit: _initialLimit,
  searchFirst = false,
}: ExploreClientProps) {
  const searchParams = useSearchParams();
  const stories = useStoriesOptional();
  const initialQ = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(initialQ);
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [feed, setFeed] = useState<FeedItem[]>(initialFeed);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [total, setTotal] = useState(initialTotal);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryRef = useRef(query);
  queryRef.current = query;
  const requestSeq = useRef(0);

  useEffect(() => {
    const ids = members.map((m) => m.id);
    if (ids.length) void stories?.refreshRings(ids);
  }, [members, stories?.refreshRings]);

  useEffect(() => {
    const ids = members.map((m) => m.id);
    if (!ids.length || !stories?.refreshRings) return;
    const refresh = stories.refreshRings;
    function onVisible() {
      if (document.visibilityState === "visible") {
        void refresh(ids, { force: true });
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [members, stories?.refreshRings]);

  const fetchMembersPage = useCallback(
    async (opts: { q: string; page: number; append: boolean }) => {
      const seq = ++requestSeq.current;
      if (opts.append) setLoadingMore(true);
      else setSearching(true);
      setError(null);
      try {
        const pageLimit = directoryLimit();
        const res = await fetch(
          `/api/members?q=${encodeURIComponent(opts.q)}&page=${opts.page}&limit=${pageLimit}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error("Could not refresh member directory");
        const data = (await res.json()) as {
          members?: Record<string, unknown>[];
          total?: number;
          hasMore?: boolean;
          page?: number;
          limit?: number;
        };
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
        setTotal(typeof data.total === "number" ? data.total : nextMembers.length);
      } catch (err) {
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
    if (query === initialQ && !query && initialMembers.length > 0) {
      return;
    }
    const handle = window.setTimeout(
      () => {
        void fetchMembersPage({ q: query, page: 1, append: false });
      },
      query === initialQ ? 0 : 280,
    );
    return () => window.clearTimeout(handle);
  }, [query, initialQ, initialMembers.length, fetchMembersPage]);

  useEffect(() => {
    let cancelled = false;
    let feedSeq = 0;
    let appliedFeedVersion = "";
    let appliedContentMax = maxFeedContentVersion(initialFeed);
    let softPollInFlight = false;

    function applyItems(
      items: FeedItem[],
      nextFeedVersion: string | undefined,
      opts: { force?: boolean; requestSeq: number },
    ) {
      if (opts.requestSeq !== feedSeq) return;
      const incomingContentMax = maxFeedContentVersion(items);
      const incomingVersion =
        typeof nextFeedVersion === "string" && nextFeedVersion
          ? nextFeedVersion
          : null;

      if (opts.force) {
        if (
          !incomingVersion &&
          incomingContentMax > 0 &&
          incomingContentMax < appliedContentMax
        ) {
          return;
        }
      } else if (
        !shouldApplyExploreFeedPayload({
          requestSeq: opts.requestSeq,
          latestSeq: feedSeq,
          incomingVersion,
          appliedVersion: appliedFeedVersion,
          incomingContentMax,
          appliedContentMax,
        })
      ) {
        return;
      }

      if (incomingVersion) appliedFeedVersion = incomingVersion;
      appliedContentMax = Math.max(appliedContentMax, incomingContentMax);
      setFeed((prev) => (feedItemsEqual(prev, items) ? prev : items));
    }

    async function refreshFeed(opts?: { force?: boolean }) {
      const seq = ++feedSeq;
      try {
        const feedRes = await fetch("/api/feed?limit=8", { cache: "no-store" });
        if (!feedRes.ok || cancelled || seq !== feedSeq) return;
        const feedData = (await feedRes.json()) as {
          items?: FeedItem[];
          feedVersion?: string;
        };
        if (!Array.isArray(feedData.items)) return;
        applyItems(feedData.items, feedData.feedVersion, {
          force: opts?.force,
          requestSeq: seq,
        });
      } catch {
        /* keep SSR feed */
      }
    }

    async function softPollFeed() {
      if (cancelled || softPollInFlight) return;
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      softPollInFlight = true;
      const seq = ++feedSeq;
      try {
        const since = appliedFeedVersion
          ? `&sinceVersion=${encodeURIComponent(appliedFeedVersion)}`
          : "";
        const res = await fetch(`/api/feed?poll=1&limit=8${since}`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled || seq !== feedSeq) return;
        const data = (await res.json()) as {
          unchanged?: boolean;
          feedVersion?: string;
          items?: FeedItem[];
        };
        if (cancelled || seq !== feedSeq) return;
        if (data.unchanged) {
          if (typeof data.feedVersion === "string") {
            appliedFeedVersion = data.feedVersion;
          }
          return;
        }
        if (!Array.isArray(data.items)) return;
        applyItems(data.items, data.feedVersion, { requestSeq: seq });
      } catch {
        /* silent — avoid toast spam */
      } finally {
        softPollInFlight = false;
      }
    }

    // Immediate refresh — client navigation can reuse a stale RSC payload.
    void refreshFeed({ force: true });

    const pollId = window.setInterval(
      () => void softPollFeed(),
      EXPLORE_FEED_SOFT_POLL_MS,
    );
    const onVis = () => {
      if (document.visibilityState === "visible") void softPollFeed();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    window.addEventListener("online", onVis);

    let unsubStatus: () => void = () => {};
    let unsubOpp: () => void = () => {};
    void import("@/lib/status-surface-sync").then(({ subscribeStatusChanged }) => {
      unsubStatus = subscribeStatusChanged((payload) => {
        const version =
          payload.version ??
          payload.status?.version ??
          (payload.status ? Date.parse(payload.status.postedAt) : 0);
        if (version && version < appliedContentMax) return;
        if (version) appliedContentMax = Math.max(appliedContentMax, version);
        // Publisher / same-tab: apply immediately (do not wait for poll).
        void refreshFeed({ force: true });
        void fetchMembersPage({ q: queryRef.current, page: 1, append: false });
      });
    });
    void import("@/lib/opportunity-surface-sync").then(
      ({ subscribeOpportunityChanged }) => {
        unsubOpp = subscribeOpportunityChanged((payload) => {
          const version =
            payload.version ??
            payload.opportunity?.version ??
            (payload.opportunity
              ? Date.parse(payload.opportunity.postedAt)
              : 0);
          if (version && version < appliedContentMax) return;
          if (version) appliedContentMax = Math.max(appliedContentMax, version);
          void refreshFeed({ force: true });
        });
      },
    );

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      window.removeEventListener("online", onVis);
      unsubStatus();
      unsubOpp();
    };
    // initialFeed is only the mount baseline for version; do not re-bind on prop churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-time feed sync
  }, [fetchMembersPage]);

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

        <div className="mx-auto mt-8 max-w-3xl sm:mt-10">
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

        <section className="mx-auto mt-8 max-w-5xl sm:mt-10">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">
              Live
            </h2>
            <Link
              href="/activity"
              className="text-[11px] font-medium uppercase tracking-[0.14em] text-electric/80 transition-colors hover:text-electric"
            >
              View All Activity
            </Link>
          </div>
          <LiveFeedSplit
            items={feed.slice(0, FEED_PREVIEW_LIMIT * 2)}
            perColumnLimit={FEED_PREVIEW_LIMIT}
          />
        </section>

        <section className="mt-10 sm:mt-12">
          <div className="mb-4 flex items-baseline justify-between gap-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
              People
            </h2>
            <p className="text-sm text-white/40">
              {searching
                ? "Updating…"
                : `${total} member${total === 1 ? "" : "s"}`}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5">
            {members.map((member) => (
              <MemberDirectoryCard key={member.id} member={member} />
            ))}
          </div>

          {!members.length && !searching ? (
            <p className="mt-16 text-center text-white/50">
              No members match this search. Try a place, product, or username.
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
                className="rounded-lg border border-white/20 px-5 py-2.5 text-xs font-medium uppercase tracking-[0.14em] text-white/80 hover:border-electric/40 hover:text-white disabled:opacity-50"
              >
                {loadingMore ? "Loading…" : "Load more people"}
              </button>
            </div>
          ) : null}
        </section>
      </Container>
    </div>
  );
}
