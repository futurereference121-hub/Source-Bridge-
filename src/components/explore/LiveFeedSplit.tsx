"use client";

import type { FeedItem } from "@/lib/types";
import { CircleDot, Sparkles } from "lucide-react";
import { LiveFeed } from "@/components/explore/LiveFeed";

type Props = {
  items: FeedItem[];
  /** Max items per column when split (preview mode). */
  perColumnLimit?: number;
};

function EmptyColumn({
  kind,
}: {
  kind: "status" | "opportunity";
}) {
  const isOpp = kind === "opportunity";
  return (
    <div
      className={`flex min-h-[7rem] flex-col items-center justify-center rounded-xl px-4 py-5 text-center ${
        isOpp ? "text-amber-100/50" : "text-sky-100/45"
      }`}
    >
      {isOpp ? (
        <Sparkles size={18} className="text-amber-300/45" aria-hidden />
      ) : (
        <CircleDot size={18} className="text-sky-300/40" aria-hidden />
      )}
      <p className="mt-2 text-sm leading-relaxed">
        {isOpp
          ? "No opportunities yet — travel windows and sourcing asks will appear here."
          : "No status or Live yet — member updates will appear here."}
      </p>
    </div>
  );
}

/**
 * Independent floating Status + Opportunities cards.
 * Desktop: side-by-side with spacing. Mobile: stacked.
 * Each card has its own contained scroll — no shared enclosing box.
 */
export function LiveFeedSplit({ items, perColumnLimit }: Props) {
  const statuses = items.filter((i) => i.kind !== "opportunity");
  const opportunities = items.filter((i) => i.kind === "opportunity");
  const statusItems = perColumnLimit
    ? statuses.slice(0, perColumnLimit)
    : statuses;
  const oppItems = perColumnLimit
    ? opportunities.slice(0, perColumnLimit)
    : opportunities;

  return (
    <div className="grid gap-4 md:grid-cols-2 md:gap-5 md:items-start">
      <article className="flex min-h-0 flex-col rounded-2xl border border-sky-400/20 bg-gradient-to-br from-sky-500/[0.07] to-white/[0.02] p-3 shadow-[0_12px_32px_-18px_rgba(56,189,248,0.45)] sm:p-4">
        <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-300/80">
          <CircleDot size={12} aria-hidden />
          Status / Live
        </h3>
        <div className="max-h-[min(42vh,22rem)] overflow-y-auto overscroll-contain pr-0.5 md:max-h-[min(48vh,26rem)]">
          {statusItems.length ? (
            <LiveFeed items={statusItems} />
          ) : (
            <EmptyColumn kind="status" />
          )}
        </div>
      </article>
      <article className="flex min-h-0 flex-col rounded-2xl border border-amber-400/25 bg-gradient-to-br from-amber-400/[0.08] to-white/[0.02] p-3 shadow-[0_12px_32px_-18px_rgba(251,191,36,0.35)] sm:p-4">
        <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-300/85">
          <Sparkles size={12} aria-hidden />
          Opportunities
        </h3>
        <div className="max-h-[min(42vh,22rem)] overflow-y-auto overscroll-contain pr-0.5 md:max-h-[min(48vh,26rem)]">
          {oppItems.length ? (
            <LiveFeed items={oppItems} />
          ) : (
            <EmptyColumn kind="opportunity" />
          )}
        </div>
      </article>
    </div>
  );
}
