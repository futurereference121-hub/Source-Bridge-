"use client";

import Image from "next/image";
import Link from "next/link";
import type { FeedItem } from "@/lib/types";
import { memberPhoto } from "@/lib/placeholders";

type LiveFeedProps = {
  items: FeedItem[];
};

function formatRelativeTime(iso: string): string | null {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const diffMs = Date.now() - then;
  if (diffMs < 0) return null;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return null;
}

export function LiveFeed({ items }: LiveFeedProps) {
  if (!items.length) {
    return (
      <p className="px-1 py-2 text-sm leading-relaxed text-white/50">
        No live activity yet. New member updates will appear here.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-white/[0.06]">
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
  const kindLabel = item.kind === "opportunity" ? "Opportunity" : "Status";
  const photo = memberPhoto(item.photo);

  return (
    <Link
      href={`/members/${item.memberSlug}`}
      className="flex items-start gap-3 px-1 py-3 transition-colors hover:bg-white/[0.03] sm:gap-3.5 sm:px-2 sm:py-3.5"
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
            <span className="shrink-0 rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-white/45">
              {kindLabel}
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
