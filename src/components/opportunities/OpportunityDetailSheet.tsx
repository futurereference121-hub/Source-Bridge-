"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { X } from "lucide-react";
import type { OpportunityPublic } from "@/lib/opportunities/map";
import { buildOpportunityMessageContext } from "@/lib/opportunities/map";
import { SafeMemberImage } from "@/components/ui/SafeMemberImage";
import { ContactSellerButton } from "@/components/marketplace/ContactSellerButton";
import {
  deliveryModeLabel,
  opportunityKindBadgeLabel,
} from "@/lib/opportunities/presentation";

type Props = {
  opportunity: OpportunityPublic | null;
  open: boolean;
  onClose: () => void;
  /** When viewing own opportunity management actions. */
  isOwner?: boolean;
  ownerActions?: ReactNode;
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-white/35">
        {label}
      </dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function place(city?: string, country?: string) {
  return [city, country].filter(Boolean).join(", ");
}

function fmtLong(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function OpportunityDetailSheet({
  opportunity: o,
  open,
  onClose,
  isOwner,
  ownerActions,
}: Props) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    document.addEventListener("keydown", handleKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    queueMicrotask(() => closeRef.current?.focus());
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open, handleKey]);

  useEffect(() => {
    if (!open || !o) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("id") !== o.id) {
      url.searchParams.set("id", o.id);
      window.history.replaceState(null, "", url.toString());
    }
    return () => {
      const u = new URL(window.location.href);
      if (u.searchParams.get("id") === o.id) {
        u.searchParams.delete("id");
        window.history.replaceState(null, "", u.toString());
      }
    };
  }, [open, o]);

  if (!open || !o) return null;

  const photo = o.photos[0];
  const badge = opportunityKindBadgeLabel(o.kind);
  const deliveryPref = deliveryModeLabel(o.deliveryMode);
  const source =
    place(o.sourceCity, o.sourceCountry) || place(o.city, o.country);
  const delivery = place(o.deliveryCity, o.deliveryCountry);
  const origin = place(o.originCity, o.originCountry);
  const destination = place(o.city, o.country);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-6"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/65"
        aria-label="Close opportunity"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-[81] flex max-h-[min(92svh,920px)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-white/12 bg-[#0b1220] shadow-2xl sm:rounded-2xl"
        style={{
          paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
        }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200/90">
            {badge}
          </span>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-white/70 hover:bg-white/5 hover:text-white"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {photo ? (
            <div className="relative mb-4 aspect-[16/10] overflow-hidden rounded-xl bg-navy-mid">
              <Image src={photo} alt="" fill className="object-cover" sizes="512px" />
            </div>
          ) : null}
          <h2 id={titleId} className="font-display text-xl text-white sm:text-2xl">
            {o.title}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-white/70">
            {o.description}
          </p>

          <dl className="mt-4 space-y-2 text-sm text-white/65">
            {o.kind === "BUYER_REQUEST" ? (
              <>
                {source ? <Field label="Source from">{source}</Field> : null}
                {delivery ? <Field label="Deliver to">{delivery}</Field> : null}
                {o.quantity?.trim() ? (
                  <Field label="Quantity">{o.quantity.trim()}</Field>
                ) : null}
                {o.expiresAt ? (
                  <Field label="Needed by">{fmtLong(o.expiresAt)}</Field>
                ) : null}
                {(o.budgetMinMinor != null || o.budgetMaxMinor != null) &&
                o.budgetCurrency ? (
                  <Field label="Budget (informational)">
                    {o.budgetMinMinor != null
                      ? (o.budgetMinMinor / 100).toLocaleString()
                      : "—"}
                    {" – "}
                    {o.budgetMaxMinor != null
                      ? (o.budgetMaxMinor / 100).toLocaleString()
                      : "—"}{" "}
                    {o.budgetCurrency.toUpperCase()}
                  </Field>
                ) : null}
                {deliveryPref ? (
                  <Field label="Delivery preference">{deliveryPref}</Field>
                ) : null}
                {o.alternativesOk != null ? (
                  <Field label="Alternatives">
                    {o.alternativesOk ? "OK" : "Not preferred"}
                  </Field>
                ) : null}
              </>
            ) : null}

            {o.kind === "SOURCING_OFFER" ? (
              <>
                {source ? <Field label="Available in">{source}</Field> : null}
                {o.expiresAt ? (
                  <Field label="Available until">{fmtLong(o.expiresAt)}</Field>
                ) : null}
                {o.internationalShipping != null || o.localHandover != null ? (
                  <Field label="Fulfilment">
                    {[
                      o.internationalShipping ? "International shipping" : null,
                      o.localHandover ? "Local handover / hand-delivery" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Not specified"}
                  </Field>
                ) : null}
                {o.specialistDetails ? (
                  <Field label="Specialist details">
                    <span className="whitespace-pre-wrap">
                      {o.specialistDetails}
                    </span>
                  </Field>
                ) : null}
                {o.sizeLimits ? (
                  <Field label="Size limits">{o.sizeLimits}</Field>
                ) : null}
              </>
            ) : null}

            {o.kind === "TRAVEL_OPPORTUNITY" ? (
              <>
                {origin && destination ? (
                  <Field label="Travelling">
                    {origin} → {destination}
                  </Field>
                ) : destination ? (
                  <Field label="Travelling to">{destination}</Field>
                ) : null}
                {(o.travelStartAt || o.travelEndAt) && (
                  <Field label="Travel dates">
                    {[o.travelStartAt, o.travelEndAt]
                      .filter(Boolean)
                      .map((d) => fmtLong(d!))
                      .join(" → ")}
                  </Field>
                )}
                {o.markets.length ? (
                  <Field label="Markets / areas I expect to visit">
                    {o.markets.join(" · ")}
                  </Field>
                ) : null}
                {o.internationalShipping != null || o.localHandover != null ? (
                  <Field label="Can help with">
                    {[
                      o.internationalShipping ? "Shipping" : null,
                      o.localHandover ? "Hand-delivery" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Not specified"}
                  </Field>
                ) : null}
                {o.luggageRestrictions ? (
                  <Field label="Luggage">{o.luggageRestrictions}</Field>
                ) : null}
              </>
            ) : null}

            {o.kind === "LEGACY_GENERAL" ? (
              <>
                {place(o.city, o.country) ? (
                  <Field label="Location">{place(o.city, o.country)}</Field>
                ) : null}
                {o.expiresAt ? (
                  <Field label="Until">{fmtLong(o.expiresAt)}</Field>
                ) : null}
              </>
            ) : null}

            {o.categories.length ? (
              <Field label="Categories">{o.categories.join(" · ")}</Field>
            ) : null}
            {o.notes ? (
              <Field label="Notes">
                <span className="whitespace-pre-wrap">{o.notes}</span>
              </Field>
            ) : null}
            <Field label="Status">
              <span className="uppercase tracking-wide">
                {o.lifecycle.replaceAll("_", " ")}
              </span>
            </Field>
          </dl>

          {o.creator ? (
            <div className="mt-5 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <Link
                href={`/members/${o.creator.slug}`}
                className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
                aria-label={`View profile of ${o.creator.fullName}, @${o.creator.username}`}
              >
                <SafeMemberImage
                  src={o.creator.photo}
                  alt=""
                  fill
                  sizes="40px"
                  className="object-cover"
                />
              </Link>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-white">{o.creator.fullName}</p>
                <Link
                  href={`/members/${o.creator.slug}`}
                  className="text-xs text-electric hover:underline"
                  aria-label={`View profile @${o.creator.username}`}
                >
                  @{o.creator.username}
                </Link>
              </div>
            </div>
          ) : null}

          {isOwner && ownerActions ? (
            <div className="mt-5 space-y-2">{ownerActions}</div>
          ) : null}
        </div>

        {!isOwner && o.creator && o.active ? (
          <div className="border-t border-white/10 px-4 py-3">
            <ContactSellerButton
              toUserId={o.creator.id}
              toUsername={o.creator.username}
              toName={o.creator.fullName}
              toPhoto={o.creator.photo}
              opportunityId={o.id}
              opportunityTitle={o.title}
              opportunityKindLabel={o.kindLabel}
              opportunityContextSnapshot={buildOpportunityMessageContext(o)}
              label={o.responseCta}
              className="w-full justify-center"
            />
            <p className="mt-2 text-center text-[11px] text-white/35">
              Opens your conversation draft with opportunity context — nothing
              is sent automatically.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
