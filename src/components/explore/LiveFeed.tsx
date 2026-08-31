"use client";

import Link from "next/link";
import { CircleDot, MapPin, Radio, Sparkles } from "lucide-react";
import type { FeedItem } from "@/lib/types";
import { SafeMemberImage } from "@/components/ui/SafeMemberImage";
import { formatRelativeTime } from "@/lib/format";
import { StoryAvatar } from "@/components/stories/StoryAvatar";
import { useStoriesOptional } from "@/components/stories/StoryProvider";
import { useLivePresenceOptional } from "@/components/live/LivePresenceProvider";
import { useEffect } from "react";

type LiveFeedProps = {
  items: FeedItem[];
};

export function LiveFeed({ items }: LiveFeedProps) {
  const stories = useStoriesOptional();
  const livePresence = useLivePresenceOptional();

  useEffect(() => {
    const ids = [...new Set(items.map((i) => i.memberId).filter(Boolean))];
    if (ids.length) {
      void stories?.refreshRings(ids);
      void livePresence?.refreshPresence(ids);
    }
  }, [items, stories?.refreshRings, livePresence?.refreshPresence]);

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

function formatOptionalDate(iso?: string): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return null;
  }
}

function FeedRow({ item }: { item: FeedItem }) {
  const relative = formatRelativeTime(item.postedAt);
  const isOpportunity = item.kind === "opportunity";
  const isLive = item.kind === "live" || item.kind === "was_live";
  const href = isLive && item.liveSessionId
    ? `/live/${item.liveSessionId}`
    : `/members/${item.memberSlug}`;
  const place = [item.city, item.country].filter(Boolean).join(", ");
  const start = formatOptionalDate(item.startsAt);
  const end = formatOptionalDate(item.expiresAt);
  const dateRange =
    start && end ? `${start} – ${end}` : start || end || null;

  const kindStyles = isLive
    ? {
        label: item.kind === "live" ? "LIVE" : "Was Live",
        Icon: Radio,
        wrapper:
          item.kind === "live"
            ? "border border-red-500/35 bg-gradient-to-br from-red-500/[0.12] to-transparent hover:border-red-400/50"
            : "border border-white/12 bg-white/[0.02] hover:border-white/20",
        badge:
          item.kind === "live"
            ? "border-red-500/50 bg-red-600/20 text-red-300"
            : "border-white/20 bg-white/5 text-white/60",
        icon: item.kind === "live" ? "text-red-400" : "text-white/50",
      }
    : isOpportunity
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
      href={href}
      className={`flex items-start gap-3 rounded-xl px-3 py-3 transition-colors sm:gap-3.5 sm:px-3.5 sm:py-3.5 ${kindStyles.wrapper} ${isOpportunity ? "sm:-translate-y-px" : ""}`}
    >
      <div className="relative mt-0.5 shrink-0">
        <StoryAvatar
          userId={item.memberId}
          profileHref={`/members/${item.memberSlug}`}
          size={36}
          className="rounded-lg"
        >
          <SafeMemberImage
            src={item.photo}
            alt=""
            fill
            sizes="36px"
            className="object-cover"
          />
        </StoryAvatar>
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
        {isOpportunity && (place || dateRange) ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-white/40">
            {place ? (
              <span className="inline-flex items-center gap-1">
                <MapPin size={11} strokeWidth={1.75} />
                {place}
              </span>
            ) : null}
            {dateRange ? <span>{dateRange}</span> : null}
          </p>
        ) : null}
        {isLive && item.city ? (
          <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-white/40">
            <MapPin size={11} strokeWidth={1.75} />
            {item.city}
          </p>
        ) : null}
      </div>
    </Link>
  );
}
