"use client";

import { useState } from "react";
import { formatMinor } from "@/lib/payments/money";
import { GP_POSTED_WORDING } from "@/lib/payments/payout-rail/outbound-display";

type Review = {
  quoteId: string;
  confirmed: boolean;
  sourceAmountMinor: number;
  sourceCurrency: string;
  destinationAmountMinor: number;
  destinationCurrency: string;
  providerFeeMinor: number;
  providerFeeCurrency: string;
  crossBorderFeeMinor: number;
  crossBorderFeeCurrency: string;
  fxFeeMinor: number;
  fxFeeCurrency: string;
  feePayer: string;
  expiresAt: string;
};

function feeLine(label: string, amount: number, currency: string) {
  const cur = (currency || "").toUpperCase();
  return (
    <p>
      {label}: {cur ? formatMinor(amount, cur) : `${amount} (currency unavailable)`}
    </p>
  );
}

/**
 * Shared desktop and mobile review before a Global Payouts release.
 * Preparation and confirmation never create the payout themselves.
 */
export function GpQuoteReview(props: {
  protectedTxnId: string;
  kind: "FINAL" | "PROCUREMENT";
  confirmed: boolean;
  onConfirmed: (confirmed: boolean) => void;
}) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function post(action: "prepare" | "confirm") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/payments/global-payouts/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protectedTxnId: props.protectedTxnId,
          kind: props.kind,
          action,
          quoteId: action === "confirm" ? review?.quoteId : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        props.onConfirmed(false);
        throw new Error(data.error || "Payout estimate was not accepted.");
      }
      const next = data.review as Review | null;
      setReview(next);
      props.onConfirmed(Boolean(next?.confirmed));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payout estimate was not accepted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="mt-3 w-full max-w-full space-y-2 rounded-lg border border-white/15 bg-white/5 p-3 text-xs text-white/80 sm:text-sm"
      data-testid="gp-quote-review"
    >
      <p className="font-medium text-white/90">Review payout estimate</p>
      <p className="text-white/60">
        Source Bridge pays the provider fees below. They are not deducted from the sourcer entitlement.
      </p>
      {review ? (
        <div className="space-y-1">
          <p>
            Source: {formatMinor(review.sourceAmountMinor, review.sourceCurrency.toUpperCase())}
          </p>
          <p>
            Destination:{" "}
            {formatMinor(review.destinationAmountMinor, review.destinationCurrency.toUpperCase())}
          </p>
          {feeLine("Provider fee", review.providerFeeMinor, review.providerFeeCurrency)}
          {feeLine("Cross-border fee", review.crossBorderFeeMinor, review.crossBorderFeeCurrency)}
          {feeLine("FX fee", review.fxFeeMinor, review.fxFeeCurrency)}
          <p>Paid by: {review.feePayer}</p>
          <p>Estimate expires: {new Date(review.expiresAt).toLocaleString()}</p>
          <p className="text-white/55">{GP_POSTED_WORDING}</p>
        </div>
      ) : (
        <p className="text-white/55">
          Request a fresh estimate before release. An expired or changed estimate must be reviewed again.
        </p>
      )}
      <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          disabled={busy}
          onClick={() => void post("prepare")}
          className="min-h-11 w-full rounded-lg border border-white/20 px-3 py-2 text-xs text-white/85 sm:w-auto"
        >
          {busy ? "Working…" : "Review estimate"}
        </button>
        <button
          type="button"
          disabled={busy || !review || props.confirmed}
          onClick={() => void post("confirm")}
          className="min-h-11 w-full rounded-lg bg-electric px-3 py-2 text-xs font-medium text-app-navy disabled:opacity-50 sm:w-auto"
        >
          {props.confirmed ? "Estimate confirmed" : "Confirm estimate"}
        </button>
      </div>
      {error ? <p className="text-amber-300">{error}</p> : null}
    </section>
  );
}
