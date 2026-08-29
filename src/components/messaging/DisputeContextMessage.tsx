"use client";

import Link from "next/link";
import {
  resolveDisputeContextDisplay,
  type DisputeContextStructured,
} from "@/lib/payments/dispute-context-copy";

type Props = {
  body: string;
  createdAt?: string | null;
  structured?: Partial<DisputeContextStructured> | null;
  /** When true, show optional View review deep-link (admin surfaces). */
  showReviewLink?: boolean;
};

/**
 * Concise Payment Ticket issue reference card for Admin↔party support chat.
 * No raw IDs, evidence dumps, or technical metadata.
 */
export default function DisputeContextMessage({
  body,
  createdAt,
  structured,
  showReviewLink = false,
}: Props) {
  const data = resolveDisputeContextDisplay(body, {
    ...structured,
    createdAtIso: structured?.createdAtIso || createdAt || undefined,
  });

  const reviewHref = data.reviewHref;
  const canLinkReview =
    showReviewLink &&
    Boolean(reviewHref) &&
    reviewHref !== "#" &&
    reviewHref.startsWith("/admin/reviews/");

  return (
    <div
      className="space-y-1.5 text-sm text-white/90"
      data-testid="dispute-context-message"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-electric">
        PAYMENT TICKET ISSUE
      </p>
      <p>
        <span className="text-white/45">Ticket:</span> {data.title}
      </p>
      <p>
        <span className="text-white/45">Buyer:</span> {data.buyerHandle}
      </p>
      <p>
        <span className="text-white/45">Sourcer:</span> {data.sellerHandle}
      </p>
      <p>
        <span className="text-white/45">Amount:</span> {data.amountLabel}
      </p>
      <p>
        <span className="text-white/45">Status:</span> {data.statusLabel}
      </p>
      {canLinkReview ? (
        <Link
          href={reviewHref}
          className="inline-flex pt-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-electric hover:text-electric-hover"
          data-testid="dispute-context-view-review"
        >
          View review
        </Link>
      ) : null}
    </div>
  );
}
