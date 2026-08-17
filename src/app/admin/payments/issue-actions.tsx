"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  formatMinor,
  minorToMajor,
  parseHumanAmountToMinor,
} from "@/lib/payments/money";

type Props = {
  disputeId: string;
  currency: string;
  finalResidualMinor: number;
  refundableMinor: number;
};

export default function PaymentIssueActions({
  disputeId,
  currency,
  finalResidualMinor,
  refundableMinor,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refundMajor, setRefundMajor] = useState(
    refundableMinor > 0
      ? minorToMajor(
          Math.min(refundableMinor, finalResidualMinor) || refundableMinor,
          currency,
        ).toFixed(2)
      : "0.00",
  );
  const [note, setNote] = useState("");
  const [confirmText, setConfirmText] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    resolution: "RESOLVED_SELLER" | "RESOLVED_BUYER" | "RESOLVED_SPLIT" | "CLOSED";
    extra?: { refundMinor?: number; releaseRemaining?: boolean };
  } | null>(null);

  const parsedRefundMinor = useMemo(
    () => parseHumanAmountToMinor(refundMajor, currency),
    [refundMajor, currency],
  );

  async function execute(
    resolution:
      | "RESOLVED_SELLER"
      | "RESOLVED_BUYER"
      | "RESOLVED_SPLIT"
      | "CLOSED",
    extra?: { refundMinor?: number; releaseRemaining?: boolean },
  ) {
    setBusy(resolution);
    setError(null);
    try {
      const res = await fetch("/api/admin/payments/issues", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          disputeId,
          resolution,
          resolutionNote: note.trim() || undefined,
          refundMinor: extra?.refundMinor,
          releaseRemaining: extra?.releaseRemaining ?? false,
          confirmed: true,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        refundableMinor?: number;
      };
      if (!res.ok) {
        setError(data.error || `Failed (${res.status})`);
        return;
      }
      setConfirmText(null);
      setPending(null);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(null);
    }
  }

  function askConfirm(
    resolution:
      | "RESOLVED_SELLER"
      | "RESOLVED_BUYER"
      | "RESOLVED_SPLIT"
      | "CLOSED",
    extra?: { refundMinor?: number; releaseRemaining?: boolean },
    text?: string,
  ) {
    setError(null);
    setPending({ resolution, extra });
    setConfirmText(text || "Confirm this resolution?");
  }

  function startSplit(releaseRemaining: boolean) {
    if (parsedRefundMinor == null) {
      setError("Enter a valid amount in pounds (e.g. 50.00), not minor units.");
      return;
    }
    if (parsedRefundMinor > refundableMinor) {
      setError(
        `Refund cannot exceed ${formatMinor(refundableMinor, currency)} (platform remainder).`,
      );
      return;
    }
    const rest = Math.max(0, finalResidualMinor - parsedRefundMinor);
    const text = releaseRemaining
      ? `Refund ${formatMinor(parsedRefundMinor, currency)} to the buyer and release remaining ${formatMinor(rest, currency)} to the sourcer?`
      : `Refund ${formatMinor(parsedRefundMinor, currency)} to the buyer and leave remaining seller funds protected?`;
    askConfirm(
      "RESOLVED_SPLIT",
      { refundMinor: parsedRefundMinor, releaseRemaining },
      text,
    );
  }

  return (
    <div className="mt-3 space-y-2 border-t border-white/10 pt-3 text-xs">
      <label className="block text-white/50">
        Admin note (optional)
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white"
          maxLength={2000}
          disabled={Boolean(busy)}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={Boolean(busy) || finalResidualMinor <= 0}
          onClick={() =>
            askConfirm(
              "RESOLVED_SELLER",
              undefined,
              `Release ${formatMinor(finalResidualMinor, currency)} residual to the sourcer?`,
            )
          }
          className="rounded-lg bg-electric px-3 py-1.5 text-xs font-medium text-app-navy disabled:opacity-50"
        >
          {busy === "RESOLVED_SELLER"
            ? "Releasing…"
            : `Release residual to seller (${formatMinor(finalResidualMinor, currency)})`}
        </button>
        <button
          type="button"
          disabled={Boolean(busy) || refundableMinor <= 0}
          onClick={() =>
            askConfirm(
              "RESOLVED_BUYER",
              undefined,
              `Refund ${formatMinor(refundableMinor, currency)} remaining to the buyer?`,
            )
          }
          className="rounded-lg border border-white/25 px-3 py-1.5 text-xs text-white disabled:opacity-50"
        >
          {busy === "RESOLVED_BUYER"
            ? "Refunding…"
            : `Refund buyer remaining (${formatMinor(refundableMinor, currency)})`}
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block text-white/50">
          Partial refund ({currency.toUpperCase()}, e.g. 50.00 — max{" "}
          {formatMinor(refundableMinor, currency)})
          <input
            value={refundMajor}
            onChange={(e) => setRefundMajor(e.target.value)}
            inputMode="decimal"
            className="mt-1 w-40 rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white"
            disabled={Boolean(busy) || refundableMinor <= 0}
            placeholder="0.00"
          />
        </label>
        <button
          type="button"
          disabled={Boolean(busy) || refundableMinor <= 0}
          onClick={() => startSplit(false)}
          className="rounded-lg border border-amber-400/40 px-3 py-1.5 text-xs text-amber-100 disabled:opacity-50"
        >
          {busy === "RESOLVED_SPLIT" ? "Applying…" : "Partial refund only"}
        </button>
        <button
          type="button"
          disabled={Boolean(busy) || refundableMinor <= 0}
          onClick={() => startSplit(true)}
          className="rounded-lg border border-amber-400/40 px-3 py-1.5 text-xs text-amber-100 disabled:opacity-50"
        >
          Partial refund + release rest
        </button>
      </div>
      <p className="text-white/35">
        Amounts are in {currency.toUpperCase()} (not Stripe minor units). Server
        clamps refunds to platform-held remainder. Already-released item funds
        are never reversed automatically.
      </p>
      {confirmText && pending ? (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-3 text-amber-50">
          <p>{confirmText}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void execute(pending.resolution, pending.extra)}
              className="rounded-lg bg-electric px-3 py-1.5 text-xs font-medium text-app-navy disabled:opacity-50"
            >
              {busy ? "Working…" : "Confirm resolution"}
            </button>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => {
                setConfirmText(null);
                setPending(null);
              }}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/70"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p className="text-amber-200/90">{error}</p> : null}
    </div>
  );
}
