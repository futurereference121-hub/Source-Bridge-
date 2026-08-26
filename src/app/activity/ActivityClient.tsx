"use client";

import { useEffect, useState } from "react";
import type { FeedItem } from "@/lib/types";
import { LiveFeedSplit } from "@/components/explore/LiveFeedSplit";
import { Container } from "@/components/ui/Container";
import { SourceBridgeLoader } from "@/components/ui/SourceBridgeLoader";

export function ActivityClient() {
  const [items, setItems] = useState<FeedItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    let seq = 0;
    let feedVersion = 0;

    async function load() {
      const mySeq = ++seq;
      try {
        const res = await fetch("/api/feed?limit=50", {
          cache: "no-store",
        });
        if (!res.ok) throw new Error("Failed to load feed");
        const data = (await res.json()) as { items?: FeedItem[] };
        if (cancelled || mySeq !== seq) return;
        const next = Array.isArray(data.items) ? data.items : [];
        const nextVersion = next.reduce((max, item) => {
          if (item.kind !== "status") return max;
          const ts = Date.parse(item.postedAt);
          return Number.isFinite(ts) && ts > max ? ts : max;
        }, 0);
        if (nextVersion > 0 && nextVersion < feedVersion) return;
        feedVersion = Math.max(feedVersion, nextVersion);
        setItems(next);
      } catch {
        if (!cancelled && mySeq === seq) setItems([]);
      }
    }
    void load();
    let unsub: () => void = () => {};
    void import("@/lib/status-surface-sync").then(({ subscribeStatusChanged }) => {
      unsub = subscribeStatusChanged((payload) => {
        const version =
          payload.version ??
          payload.status?.version ??
          (payload.status ? Date.parse(payload.status.postedAt) : 0);
        if (version && version < feedVersion) return;
        if (version) feedVersion = Math.max(feedVersion, version);
        void load();
      });
    });
    return () => {
      cancelled = true;
      unsub();
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
