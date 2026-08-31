"use client";

import { useEffect, useState } from "react";
import type { FeedItem } from "@/lib/types";
import {
  maxFeedContentVersion,
  shouldApplyExploreFeedPayload,
} from "@/lib/explore-feed-activity";
import { LiveFeedSplit } from "@/components/explore/LiveFeedSplit";
import { Container } from "@/components/ui/Container";
import { SourceBridgeLoader } from "@/components/ui/SourceBridgeLoader";

const ACTIVITY_FEED_SOFT_POLL_MS = 2500;

export function ActivityClient() {
  const [items, setItems] = useState<FeedItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    let seq = 0;
    let appliedFeedVersion = "";
    let appliedContentMax = 0;
    let softPollInFlight = false;

    function applyItems(
      next: FeedItem[],
      nextFeedVersion: string | undefined,
      requestSeq: number,
      force = false,
    ) {
      if (requestSeq !== seq) return;
      const incomingContentMax = maxFeedContentVersion(next);
      const incomingVersion =
        typeof nextFeedVersion === "string" && nextFeedVersion
          ? nextFeedVersion
          : null;
      if (
        !force &&
        !shouldApplyExploreFeedPayload({
          requestSeq,
          latestSeq: seq,
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
      setItems(next);
    }

    async function load(force = false) {
      const mySeq = ++seq;
      try {
        const res = await fetch("/api/feed?limit=50", {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("Failed to load feed");
        const data = (await res.json()) as {
          items?: FeedItem[];
          feedVersion?: string;
        };
        if (cancelled || mySeq !== seq) return;
        const next = Array.isArray(data.items) ? data.items : [];
        applyItems(next, data.feedVersion, mySeq, force);
      } catch {
        if (!cancelled && mySeq === seq) setItems([]);
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
      const mySeq = ++seq;
      try {
        const since = appliedFeedVersion
          ? `&sinceVersion=${encodeURIComponent(appliedFeedVersion)}`
          : "";
        const res = await fetch(`/api/feed?poll=1&limit=50${since}`, {
          cache: "no-store",
        });
        if (!res.ok || cancelled || mySeq !== seq) return;
        const data = (await res.json()) as {
          unchanged?: boolean;
          feedVersion?: string;
          items?: FeedItem[];
        };
        if (cancelled || mySeq !== seq) return;
        if (data.unchanged) {
          if (typeof data.feedVersion === "string") {
            appliedFeedVersion = data.feedVersion;
          }
          return;
        }
        if (!Array.isArray(data.items)) return;
        applyItems(data.items, data.feedVersion, mySeq);
      } catch {
        /* silent */
      } finally {
        softPollInFlight = false;
      }
    }

    void load(true);
    const pollId = window.setInterval(
      () => void softPollFeed(),
      ACTIVITY_FEED_SOFT_POLL_MS,
    );
    const onVis = () => {
      if (document.visibilityState === "visible") void softPollFeed();
    };
    document.addEventListener("visibilitychange", onVis);

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
        void load(true);
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
          void load(true);
        });
      },
    );

    let unsubLive: () => void = () => {};
    void import("@/lib/live-surface-sync").then(({ subscribeLiveChanged }) => {
      unsubLive = subscribeLiveChanged(() => {
        void load(true);
      });
    });

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      document.removeEventListener("visibilitychange", onVis);
      unsubStatus();
      unsubOpp();
      unsubLive();
    };
  }, []);

  return (
    <div className="bg-app-navy min-h-[100svh] pt-24 pb-24 text-white sm:pt-28 sm:pb-28">
      <Container>
        <header className="mx-auto max-w-2xl text-center">
          <h1 className="font-display text-[1.65rem] tracking-tight text-white sm:text-4xl">
            Live Activity
          </h1>
        </header>

        <section className="mx-auto mt-10 max-w-2xl sm:mt-12">
          <div className="panel-navy rounded-xl px-4 py-4 sm:px-5 sm:py-5">
            {items === null ? (
              <SourceBridgeLoader label="Loading activity…" />
            ) : (
              <LiveFeedSplit items={items} />
            )}
          </div>
        </section>
      </Container>
    </div>
  );
}
