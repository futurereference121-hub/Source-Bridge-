"use client";

import Link from "next/link";
import { CircleDot, Radio, Sparkles } from "lucide-react";
import type { FeedItem } from "@/lib/types";
import { SafeMemberImage } from "@/components/ui/SafeMemberImage";
import { formatRelativeTime } from "@/lib/format";
import { StoryAvatar } from "@/components/stories/StoryAvatar";
import { useStoriesOptional } from "@/components/stories/StoryProvider";
import { useLivePresenceOptional } from "@/components/live/LivePresenceProvider";
import { useEffect, type KeyboardEvent, type MouseEvent } from "react";
import {
  buildCompactOpportunityLines,
  opportunityKindBadgeLabel,
  parseOpportunityIdFromFeedItemId,
} from "@/lib/opportunities/presentation";

type LiveFeedProps = {
  items: FeedItem[];
  /** Opportunity ticket body opens detail overlay (not profile). */
  onOpenOpportunity?: (opportunityId: string) => void;
};

export function LiveFeed({ items, onOpenOpportunity }: LiveFeedProps) {
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
          <FeedRow item={item} onOpenOpportunity={onOpenOpportunity} />
        </li>
      ))}
    </ul>
  );
}

function stopRowOpen(e: MouseEvent | KeyboardEvent) {
  e.stopPropagation();
}

function FeedRow({
  item,
  onOpenOpportunity,
}: {
  item: FeedItem;
  onOpenOpportunity?: (opportunityId: string) => void;
}) {
  const relative = formatRelativeTime(item.postedAt);
  const isOpportunity = item.kind === "opportunity";
  const isLive = item.kind === "live" || item.kind === "was_live";
  const profileHref = `/members/${item.memberSlug}`;
  const opportunityId =
    item.opportunityId ||
    (isOpportunity ? parseOpportunityIdFromFeedItemId(item.id) : null);

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
          label: opportunityKindBadgeLabel(item.opportunityKind),
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

  const compactLines = isOpportunity
    ? buildCompactOpportunityLines(
        {
          kind: item.opportunityKind || "LEGACY_GENERAL",
          city: item.city,
          country: item.country,
          sourceCity: item.sourceCity,
          sourceCountry: item.sourceCountry,
          deliveryCity: item.deliveryCity,
          deliveryCountry: item.deliveryCountry,
          originCity: item.originCity,
          originCountry: item.originCountry,
          startsAt: item.startsAt,
          expiresAt: item.expiresAt,
          travelStartAt: item.travelStartAt,
          travelEndAt: item.travelEndAt,
          quantity: item.quantity,
          // Budget is authenticated detail-only — never on compact cards.
          markets: item.markets,
          internationalShipping: item.internationalShipping,
          localHandover: item.localHandover,
          deliveryMode: item.deliveryMode,
        },
        { includeMarkets: false },
      )
    : [];

  if (isOpportunity && opportunityId && onOpenOpportunity) {
    const openDetail = () => onOpenOpportunity(opportunityId);
    const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openDetail();
      }
    };

    return (
      <article
        role="button"
        tabIndex={0}
        onClick={openDetail}
        onKeyDown={onKeyDown}
        className={`flex cursor-pointer items-start gap-3 rounded-xl px-3 py-3 transition-colors sm:gap-3.5 sm:px-3.5 sm:py-3.5 ${kindStyles.wrapper} sm:-translate-y-px`}
        aria-label={`Open ${kindStyles.label}: ${item.text}`}
      >
        <div className="relative mt-0.5 shrink-0" onClick={stopRowOpen}>
          <StoryAvatar
            userId={item.memberId}
            profileHref={profileHref}
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
              <Link
                href={profileHref}
                onClick={stopRowOpen}
                onKeyDown={stopRowOpen}
                className="truncate text-sm font-medium text-white hover:text-electric"
                aria-label={`View profile @${item.username}`}
              >
                @{item.username}
              </Link>
              <span
                className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.12em] ${kindStyles.badge}`}
              >
                <kindStyles.Icon
                  size={11}
                  strokeWidth={2}
                  className={kindStyles.icon}
                />
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
          {compactLines.length ? (
            <dl className="mt-1.5 space-y-0.5 text-[11px] text-white/40">
              {compactLines.slice(0, 4).map((line) => (
                <div
                  key={`${line.label}:${line.value}`}
                  className="flex gap-1.5"
                >
                  <dt className="shrink-0 uppercase tracking-wide text-white/30">
                    {line.label}:
                  </dt>
                  <dd className="min-w-0 truncate">{line.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </article>
    );
  }

  // Opportunity without overlay host: marketplace deep-link (never poster profile).
  if (isOpportunity && opportunityId) {
    return (
      <a
        href={`/opportunities?id=${encodeURIComponent(opportunityId)}`}
        className={`flex items-start gap-3 rounded-xl px-3 py-3 transition-colors sm:gap-3.5 sm:px-3.5 sm:py-3.5 ${kindStyles.wrapper} sm:-translate-y-px`}
        aria-label={`Open ${kindStyles.label}: ${item.text}`}
      >
        <div className="relative mt-0.5 shrink-0">
          <div className="relative h-9 w-9 overflow-hidden rounded-lg">
            <SafeMemberImage
              src={item.photo}
              alt=""
              fill
              sizes="36px"
              className="object-cover"
            />
          </div>
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
                <kindStyles.Icon
                  size={11}
                  strokeWidth={2}
                  className={kindStyles.icon}
                />
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
      </a>
    );
  }

  const href =
    isLive && item.liveSessionId
      ? `/live/${item.liveSessionId}`
      : profileHref;

  return (
    <Link
      href={href}
      className={`flex items-start gap-3 rounded-xl px-3 py-3 transition-colors sm:gap-3.5 sm:px-3.5 sm:py-3.5 ${kindStyles.wrapper}`}
    >
      <div className="relative mt-0.5 shrink-0">
        <StoryAvatar
          userId={item.memberId}
          profileHref={profileHref}
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
              <kindStyles.Icon
                size={11}
                strokeWidth={2}
                className={kindStyles.icon}
              />
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
        {isLive && item.city ? (
          <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-white/40">
            {item.city}
          </p>
        ) : null}
      </div>
    </Link>
  );
}
