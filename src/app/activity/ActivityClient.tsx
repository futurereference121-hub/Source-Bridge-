"use client";

import { useEffect, useState } from "react";
import type { FeedItem } from "@/lib/types";
import { LiveFeed } from "@/components/explore/LiveFeed";
import { Container } from "@/components/ui/Container";

export function ActivityClient() {
  const [items, setItems] = useState<FeedItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/feed?limit=50");
        if (!res.ok) throw new Error("Failed to load feed");
        const data = (await res.json()) as { items?: FeedItem[] };
        if (!cancelled) {
          setItems(Array.isArray(data.items) ? data.items : []);
        }
      } catch {
        if (!cancelled) setItems([]);
      }
    }
    void load();
    return () => {
      cancelled = true;
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
              <p className="px-1 py-2 text-sm text-white/45">Loading…</p>
            ) : (
              <LiveFeed items={items} />
            )}
          </div>
        </section>
      </Container>
    </div>
  );
}
