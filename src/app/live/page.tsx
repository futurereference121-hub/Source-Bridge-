"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { LiveBadge } from "@/components/live/LiveBadge";
import type { LiveSessionPublic } from "@/lib/live/public-types";

type Item = LiveSessionPublic & { kind: "live" | "was_live" };

export default function LiveDiscoverPage() {
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/live/sessions?limit=40")
      .then((r) => r.json())
      .then((data: { items?: Item[] }) => {
        if (!cancelled) setItems(data.items || []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-[100svh] bg-app-navy pb-24 pt-28 text-white">
      <Container className="max-w-lg">
        <h1 className="font-display text-3xl">Live</h1>
        <p className="mt-2 text-sm text-white/55">
          Public titles and locations. Sign in to watch.
        </p>
        <ul className="mt-8 space-y-3">
          {items === null ? (
            <li className="text-sm text-white/45">Loading…</li>
          ) : items.length === 0 ? (
            <li className="text-sm text-white/45">No Live sessions right now.</li>
          ) : (
            items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/live/${item.id}`}
                  className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <LiveBadge
                        label={item.kind === "live" ? "LIVE" : "Was Live"}
                      />
                      <span className="text-sm font-medium">
                        @{item.broadcaster.username}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-white/70">{item.title}</p>
                    <p className="text-xs text-white/40">{item.locationLabel}</p>
                  </div>
                </Link>
              </li>
            ))
          )}
        </ul>
      </Container>
    </div>
  );
}
