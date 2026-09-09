"use client";

import Image from "next/image";
import { MapPin } from "lucide-react";
import type { OpportunityPublic } from "@/lib/opportunities/map";
import { SafeMemberImage } from "@/components/ui/SafeMemberImage";

type Props = {
  opportunity: OpportunityPublic;
  onOpen: (id: string) => void;
};

function formatBudget(o: OpportunityPublic): string | null {
  if (!o.budgetCurrency) return null;
  if (o.budgetMinMinor == null && o.budgetMaxMinor == null) return null;
  const fmt = (n: number) =>
    (n / 100).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const cur = o.budgetCurrency.toUpperCase();
  if (o.budgetMinMinor != null && o.budgetMaxMinor != null) {
    return `${fmt(o.budgetMinMinor)}–${fmt(o.budgetMaxMinor)} ${cur}`;
  }
  if (o.budgetMinMinor != null) return `from ${fmt(o.budgetMinMinor)} ${cur}`;
  return `up to ${fmt(o.budgetMaxMinor!)} ${cur}`;
}

function formatDates(o: OpportunityPublic): string | null {
  const start = o.travelStartAt || o.startsAt;
  const end = o.travelEndAt || o.expiresAt;
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (end) return `Until ${fmt(end)}`;
  if (start) return `From ${fmt(start)}`;
  return null;
}

export function OpportunityTicket({ opportunity: o, onOpen }: Props) {
  const photo = o.photos[0];
  const place = [o.city, o.country].filter(Boolean).join(", ");
  const delivery = [o.deliveryCity, o.deliveryCountry].filter(Boolean).join(", ");
  const budget = formatBudget(o);
  const dates = formatDates(o);

  return (
    <button
      type="button"
      onClick={() => onOpen(o.id)}
      className="card-navy flex w-full flex-col overflow-hidden rounded-xl border border-white/10 text-left transition-colors hover:border-electric/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
      aria-label={`${o.kindLabel}: ${o.title}`}
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
            {o.kindLabel}
          </span>
          <p className="mt-1.5 line-clamp-2 text-sm font-medium text-white">
            {o.title}
          </p>
          {place ? (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-white/45">
              <MapPin size={11} strokeWidth={1.75} />
              <span className="truncate">{place}</span>
            </p>
          ) : null}
          {delivery ? (
            <p className="truncate text-[11px] text-white/35">
              Delivery: {delivery}
            </p>
          ) : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-white/40">
            {budget ? <span>{budget}</span> : null}
            {dates ? <span>{dates}</span> : null}
            <span className="uppercase tracking-wide text-white/30">
              {o.lifecycle.replaceAll("_", " ")}
            </span>
          </div>
        </div>
      </div>
      {o.creator ? (
        <div className="flex items-center gap-2 border-t border-white/8 px-3 py-2 sm:px-3.5">
          <div className="relative h-6 w-6 overflow-hidden rounded-md bg-navy-mid">
            <SafeMemberImage
              src={o.creator.photo}
              alt=""
              fill
              sizes="24px"
              className="object-cover"
            />
          </div>
          <p className="truncate text-[11px] text-white/50">
            {o.creator.fullName} · @{o.creator.username}
          </p>
        </div>
      ) : null}
    </button>
  );
}
