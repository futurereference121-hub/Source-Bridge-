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
import { SafeMemberImage } from "@/components/ui/SafeMemberImage";
import { ContactSellerButton } from "@/components/marketplace/ContactSellerButton";

type Props = {
  opportunity: OpportunityPublic | null;
  open: boolean;
  onClose: () => void;
  /** When viewing own opportunity management actions. */
  isOwner?: boolean;
  ownerActions?: ReactNode;
};

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
  const place = [o.city, o.country].filter(Boolean).join(", ");

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
            {o.kindLabel}
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
            {place ? (
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-white/35">
                  Location
                </dt>
                <dd>{place}</dd>
              </div>
            ) : null}
            {o.deliveryCity ? (
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-white/35">
                  Delivery / handover
                </dt>
                <dd>
                  {[o.deliveryCity, o.deliveryCountry].filter(Boolean).join(", ")}
                </dd>
              </div>
            ) : null}
            {o.originCity ? (
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-white/35">
                  Origin
                </dt>
                <dd>
                  {[o.originCity, o.originCountry].filter(Boolean).join(", ")}
                </dd>
              </div>
            ) : null}
            {(o.travelStartAt || o.travelEndAt) && (
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-white/35">
                  Travel dates
                </dt>
                <dd>
                  {[o.travelStartAt, o.travelEndAt]
                    .filter(Boolean)
                    .map((d) =>
                      new Date(d!).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      }),
                    )
                    .join(" → ")}
                </dd>
              </div>
            )}
            {(o.budgetMinMinor != null || o.budgetMaxMinor != null) &&
            o.budgetCurrency ? (
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-white/35">
                  Budget (informational)
                </dt>
                <dd>
                  {o.budgetMinMinor != null
                    ? (o.budgetMinMinor / 100).toLocaleString()
                    : "—"}
                  {" – "}
                  {o.budgetMaxMinor != null
                    ? (o.budgetMaxMinor / 100).toLocaleString()
                    : "—"}{" "}
                  {o.budgetCurrency.toUpperCase()}
                </dd>
              </div>
            ) : null}
            {o.categories.length ? (
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-white/35">
                  Categories
                </dt>
                <dd>{o.categories.join(" · ")}</dd>
              </div>
            ) : null}
            {o.notes ? (
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-white/35">
                  Notes
                </dt>
                <dd className="whitespace-pre-wrap">{o.notes}</dd>
              </div>
            ) : null}
            {o.specialistDetails ? (
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-white/35">
                  Specialist details
                </dt>
                <dd className="whitespace-pre-wrap">{o.specialistDetails}</dd>
              </div>
            ) : null}
            {o.luggageRestrictions ? (
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-white/35">
                  Luggage
                </dt>
                <dd>{o.luggageRestrictions}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-white/35">
                Status
              </dt>
              <dd className="uppercase tracking-wide">
                {o.lifecycle.replaceAll("_", " ")}
              </dd>
            </div>
          </dl>

          {o.creator ? (
            <div className="mt-5 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="relative h-10 w-10 overflow-hidden rounded-lg">
                <SafeMemberImage
                  src={o.creator.photo}
                  alt=""
                  fill
                  sizes="40px"
                  className="object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-white">{o.creator.fullName}</p>
                <Link
                  href={`/members/${o.creator.slug}`}
                  className="text-xs text-electric hover:underline"
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
              opportunityContextSnapshot={[
                `About: ${o.kindLabel} — ${o.title}`,
                o.description.slice(0, 200),
                [o.city, o.country].filter(Boolean).join(", ")
                  ? `Location: ${[o.city, o.country].filter(Boolean).join(", ")}`
                  : "",
              ]
                .filter(Boolean)
                .join("\n")}
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
