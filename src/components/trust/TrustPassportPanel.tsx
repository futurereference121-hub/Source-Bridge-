"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import type { TrustPassportDetail, TrustPassportTier } from "@/lib/trust-passport/types";
import { TrustPassportShield } from "@/components/trust/TrustPassportShield";
import { SafeMemberImage } from "@/components/ui/SafeMemberImage";
import { memberPhoto } from "@/lib/placeholders";

type ProfileBits = {
  photo: string;
  displayName: string;
  username: string;
  slug: string;
};

type TrustPassportPanelProps = {
  open: boolean;
  onClose: () => void;
  memberSlug: string;
  isOwner: boolean;
  /** Public profile bits already on the page — used while loading. */
  profile: ProfileBits;
  /** Public tier for header while detail loads. */
  publicTier: TrustPassportTier;
};

type DetailPayload = TrustPassportDetail & { profile: ProfileBits };

export function TrustPassportPanel({
  open,
  onClose,
  memberSlug,
  isOwner,
  profile,
  publicTier,
}: TrustPassportPanelProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/members/${encodeURIComponent(memberSlug)}/trust-passport`,
          { credentials: "include", cache: "no-store" },
        );
        if (res.status === 401) {
          if (!cancelled) setError("Sign in required");
          return;
        }
        if (!res.ok) {
          if (!cancelled) setError("Trust Passport unavailable");
          return;
        }
        const data = (await res.json()) as DetailPayload;
        if (!cancelled) setDetail(data);
      } catch {
        if (!cancelled) setError("Could not load Trust Passport");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, memberSlug]);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open, loading, detail, error]);

  if (!open) return null;

  const header = detail?.profile || profile;
  const tier = detail?.tier || publicTier;
  const photo = memberPhoto(header.photo);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-6"
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/65"
        aria-label="Close Trust Passport"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-[81] flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-white/12 bg-[#0b1220] shadow-2xl sm:rounded-2xl"
        style={{
          paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
        }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border border-white/15">
              <SafeMemberImage
                src={photo}
                alt=""
                fill
                sizes="48px"
                className="object-cover"
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <TrustPassportShield tier={tier} size="sm" />
                <p
                  id={titleId}
                  className="truncate text-xs font-semibold uppercase tracking-[0.14em] text-white/90"
                >
                  {detail?.tierLabel || "Trust Passport"}
                </p>
              </div>
              <p className="mt-1 truncate text-sm text-white">
                {header.displayName || `@${header.username}`}
              </p>
              <p className="truncate text-xs text-white/50">@{header.username}</p>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="min-h-11 min-w-11 rounded-lg border border-white/15 text-sm text-white/70 hover:bg-white/5"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-4 py-4 sm:px-5">
          {loading ? (
            <p className="py-8 text-center text-sm text-white/55">Loading Trust Passport…</p>
          ) : null}
          {error ? (
            <p className="py-6 text-center text-sm text-red-300">{error}</p>
          ) : null}
          {detail ? (
            <div className="space-y-5">
              <p className="text-sm leading-relaxed text-white/70">{detail.explanation}</p>

              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
                  Verification
                </h3>
                <ul className="mt-2 space-y-1.5 text-sm text-white/80">
                  <li className="flex justify-between gap-3">
                    <span className="text-white/55">Passport verification</span>
                    <span>{detail.passportVerification}</span>
                  </li>
                  <li className="flex justify-between gap-3">
                    <span className="text-white/55">LIVE payout account</span>
                    <span>{detail.payoutAccount}</span>
                  </li>
                </ul>
              </section>

              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
                  Sourcing history
                </h3>
                <p className="mt-2 text-sm text-white/80">{detail.sourcingHistorySummary}</p>
                {detail.tier === "SILVER" &&
                detail.completedProtectedSourcingCount === 0 ? (
                  <p className="mt-1 text-sm text-white/55">
                    Verified and payout ready.
                  </p>
                ) : null}
              </section>

              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
                  {detail.reviews.verifiedTransactionReviews
                    ? "Verified transaction reviews"
                    : "Reviews"}
                </h3>
                <p className="mt-2 text-sm text-white/80">
                  {detail.reviews.count > 0
                    ? `${detail.reviews.averageRating ?? "—"} · ${detail.reviews.count} review${detail.reviews.count === 1 ? "" : "s"}`
                    : "No reviews yet."}
                </p>
              </section>

              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
                  Membership
                </h3>
                <p className="mt-2 text-sm text-white/80">{detail.memberSince}</p>
              </section>

              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
                  Sourcing areas
                </h3>
                {detail.sourcingAreas.length > 0 ? (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {detail.sourcingAreas.map((area) => (
                      <li
                        key={area.label}
                        className="rounded-md border border-white/12 bg-white/5 px-2.5 py-1 text-xs text-white/75"
                        title="Self-declared"
                      >
                        {area.label}
                        <span className="sr-only"> (self-declared)</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-white/55">No sourcing areas listed.</p>
                )}
                <p className="mt-1.5 text-[11px] text-white/40">
                  Sourcing areas are self-declared by the member.
                </p>
              </section>

              {isOwner && detail.ownerProgression ? (
                <section className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
                    Your progression
                  </h3>
                  <p className="mt-2 text-sm text-white/75">{detail.ownerProgression}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {detail.verificationHref ? (
                      <Link
                        href={detail.verificationHref}
                        className="rounded-lg border border-white/15 px-3 py-2 text-xs font-medium text-white/85 hover:bg-white/5"
                      >
                        Passport verification
                      </Link>
                    ) : null}
                    {detail.paymentsHref ? (
                      <Link
                        href={detail.paymentsHref}
                        className="rounded-lg border border-white/15 px-3 py-2 text-xs font-medium text-white/85 hover:bg-white/5"
                      >
                        Payout account
                      </Link>
                    ) : null}
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
