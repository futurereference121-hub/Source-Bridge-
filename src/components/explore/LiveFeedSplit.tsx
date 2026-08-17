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
      className={`flex min-h-[8rem] flex-col items-center justify-center rounded-xl border px-4 py-6 text-center ${
        isOpp
          ? "border-amber-400/15 bg-amber-400/[0.03]"
          : "border-sky-400/10 bg-white/[0.02]"
      }`}
    >
      {isOpp ? (
        <Sparkles size={20} className="text-amber-300/50" aria-hidden />
      ) : (
        <CircleDot size={20} className="text-sky-300/45" aria-hidden />
      )}
      <p className="mt-2 text-sm text-white/45">
        {isOpp
          ? "No opportunities yet — travel windows and sourcing asks will appear here."
          : "No status updates yet — member location posts will appear here."}
      </p>
    </div>
  );
}

/**
 * Desktop: Status + Opportunities side-by-side with independent scroll.
 * Mobile: stacked columns.
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
    <div className="grid gap-4 md:grid-cols-2 md:items-start">
      <div className="flex min-h-0 flex-col">
        <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-300/70">
          <CircleDot size={12} aria-hidden />
          Status
        </h3>
        <div className="max-h-[min(52vh,28rem)] overflow-y-auto overscroll-contain pr-0.5 md:max-h-[min(60vh,32rem)]">
          {statusItems.length ? (
            <LiveFeed items={statusItems} />
          ) : (
            <EmptyColumn kind="status" />
          )}
        </div>
      </div>
      <div className="flex min-h-0 flex-col">
        <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-300/80">
          <Sparkles size={12} aria-hidden />
          Opportunities
        </h3>
        <div className="max-h-[min(52vh,28rem)] overflow-y-auto overscroll-contain pr-0.5 md:max-h-[min(60vh,32rem)]">
          {oppItems.length ? (
            <LiveFeed items={oppItems} />
          ) : (
            <EmptyColumn kind="opportunity" />
          )}
        </div>
      </div>
    </div>
  );
}
