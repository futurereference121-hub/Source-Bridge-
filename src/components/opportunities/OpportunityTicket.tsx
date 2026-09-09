"use client";

import type { KeyboardEvent, MouseEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import type { OpportunityPublic } from "@/lib/opportunities/map";
import { SafeMemberImage } from "@/components/ui/SafeMemberImage";
import {
  buildCompactOpportunityLines,
  opportunityKindBadgeLabel,
} from "@/lib/opportunities/presentation";

type Props = {
  opportunity: OpportunityPublic;
  onOpen: (id: string) => void;
};

function stopCardOpen(e: MouseEvent | KeyboardEvent) {
  e.stopPropagation();
}

export function OpportunityTicket({ opportunity: o, onOpen }: Props) {
  const photo = o.photos[0];
  const lines = buildCompactOpportunityLines(o, {
    includeMarkets: o.kind === "TRAVEL_OPPORTUNITY" && o.markets.length <= 2,
  });
  const badge = opportunityKindBadgeLabel(o.kind);
  const profileHref = o.creator ? `/members/${o.creator.slug}` : null;

  function openDetail() {
    onOpen(o.id);
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openDetail();
    }
  }

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={openDetail}
      onKeyDown={onKeyDown}
      className="card-navy flex w-full cursor-pointer flex-col overflow-hidden rounded-xl border border-white/10 text-left transition-colors hover:border-electric/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
      aria-label={`Open ${badge}: ${o.title}`}
    >
      <div className="flex gap-3 p-3 sm:p-3.5">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-navy-mid ring-1 ring-white/10">
          {photo ? (
            <Image src={photo} alt="" fill sizes="64px" className="object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] uppercase tracking-wider text-white/30">
              Opp
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <span className="inline-flex rounded border border-amber-400/35 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-200">
            {badge}
          </span>
          <p className="mt-1.5 line-clamp-2 text-sm font-medium text-white">
            {o.title}
          </p>
          {lines.length ? (
            <dl className="mt-1.5 space-y-0.5 text-[11px] text-white/45">
              {lines.map((line) => (
                <div key={`${line.label}:${line.value}`} className="flex gap-1.5">
                  <dt className="shrink-0 uppercase tracking-wide text-white/30">
                    {line.label}:
                  </dt>
                  <dd className="min-w-0 truncate text-white/50">{line.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <p className="mt-1.5 text-[10px] uppercase tracking-wide text-white/30">
            {o.lifecycle.replaceAll("_", " ")}
          </p>
        </div>
      </div>
      {o.creator && profileHref ? (
        <div className="border-t border-white/8 px-3 py-2 sm:px-3.5">
          <Link
            href={profileHref}
            onClick={stopCardOpen}
            onKeyDown={stopCardOpen}
            className="inline-flex max-w-full items-center gap-2 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
            aria-label={`View profile of ${o.creator.fullName}, @${o.creator.username}`}
          >
            <span className="relative h-6 w-6 overflow-hidden rounded-md bg-navy-mid">
              <SafeMemberImage
                src={o.creator.photo}
                alt=""
                fill
                sizes="24px"
                className="object-cover"
              />
            </span>
            <span className="truncate text-[11px] text-white/50 hover:text-white/80">
              {o.creator.fullName} · @{o.creator.username}
            </span>
          </Link>
        </div>
      ) : null}
    </article>
  );
}
