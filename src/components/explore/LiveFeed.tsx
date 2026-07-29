"use client";

import Image from "next/image";
import Link from "next/link";
import { CircleDot, Sparkles } from "lucide-react";
import type { FeedItem } from "@/lib/types";
import { memberPhoto } from "@/lib/placeholders";
import { formatRelativeTime } from "@/lib/format";

type LiveFeedProps = {
  items: FeedItem[];
};

export function LiveFeed({ items }: LiveFeedProps) {
  if (!items.length) {
    return (
      <p className="px-1 py-2 text-sm leading-relaxed text-white/50">
        No live activity yet. New member updates will appear here.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.id}>
          <FeedRow item={item} />
        </li>
      ))}
    </ul>
  );
}

function FeedRow({ item }: { item: FeedItem }) {
  const relative = formatRelativeTime(item.postedAt);
  const photo = memberPhoto(item.photo);
  const isOpportunity = item.kind === "opportunity";

  const kindStyles = isOpportunity
    ? {
        label: "Opportunity",
        Icon: Sparkles,
        wrapper:
          "border border-amber-400/25 bg-gradient-to-br from-amber-400/[0.07] to-transparent shadow-[0_0_0_1px_rgba(251,191,36,0.05),0_8px_24px_-12px_rgba(251,191,36,0.35)] hover:border-amber-400/40 hover:from-amber-400/[0.1]",
        badge: "border-amber-400/40 bg-amber-400/10 text-amber-300",
        icon: "text-amber-300",
      }
    : {
        label: "Status",
        Icon: CircleDot,
        wrapper:
          "border border-sky-400/15 bg-white/[0.02] hover:border-sky-400/25 hover:bg-white/[0.03]",
        badge: "border-sky-400/25 bg-sky-400/[0.08] text-sky-300/90",
        icon: "text-sky-300/80",
      };

  return (
    <Link
      href={`/members/${item.memberSlug}`}
      className={`flex items-start gap-3 rounded-xl px-3 py-3 transition-colors sm:gap-3.5 sm:px-3.5 sm:py-3.5 ${kindStyles.wrapper} ${isOpportunity ? "sm:-translate-y-px" : ""}`}
    >
      <div className="relative mt-0.5 h-9 w-9 shrink-0 overflow-hidden rounded-lg bg-navy-mid ring-1 ring-white/10">
        <Image
          src={photo}
          alt=""
          fill
          sizes="36px"
          unoptimized={photo.startsWith("data:")}
          className="object-cover"
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-medium text-white">
              @{item.username}
            </p>
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] ${kindStyles.badge}`}
            >
              <kindStyles.Icon size={11} strokeWidth={2} className={kindStyles.icon} />
              {kindStyles.label}
            </span>
          </div>
          {relative ? (
            <time
              dateTime={item.postedAt}
              className="shrink-0 text-[11px] text-white/35"
            >
              {relative}
            </time>
          ) : null}
        </div>
        <p className="mt-0.5 line-clamp-2 text-sm leading-snug text-white/65">
          {item.text}
        </p>
      </div>
    </Link>
  );
}
