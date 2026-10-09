"use client";

import type { PurchaseCardModel } from "@/lib/payments/purchase-list-presentation";

/** Stored amount rows and Global Payouts status. Does not recalculate fees. */
export function PurchaseRecordedAmounts(props: { model: PurchaseCardModel }) {
  const { model } = props;
  return (
    <>
      {model.lines.map((line) => (
        <div key={line.label} className="min-w-0">
          <dt className="text-white/40">{line.label}</dt>
          <dd className="break-words text-white/85">{line.text}</dd>
        </div>
      ))}
      {model.payoutLabel ? (
        <div className="min-w-0 sm:col-span-2">
          <dt className="text-white/40">Payout</dt>
          <dd className="break-words text-white/85">{model.payoutLabel}</dd>
        </div>
      ) : null}
    </>
  );
}
