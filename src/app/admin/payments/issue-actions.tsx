"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatMinor } from "@/lib/payments/money";

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
  const [partialMinor, setPartialMinor] = useState(
    String(Math.min(refundableMinor, finalResidualMinor) || refundableMinor || 0),
  );
  const [note, setNote] = useState("");

  async function resolve(
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
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(null);
    }
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
          onClick={() => void resolve("RESOLVED_SELLER")}
          className="rounded-lg bg-electric px-3 py-1.5 text-xs font-medium text-app-navy disabled:opacity-50"
        >
          {busy === "RESOLVED_SELLER"
            ? "Releasing…"
            : `Release residual to seller (${formatMinor(finalResidualMinor, currency)})`}
        </button>
        <button
          type="button"
          disabled={Boolean(busy) || refundableMinor <= 0}
          onClick={() => void resolve("RESOLVED_BUYER")}
          className="rounded-lg border border-white/25 px-3 py-1.5 text-xs text-white disabled:opacity-50"
        >
          {busy === "RESOLVED_BUYER"
            ? "Refunding…"
            : `Refund buyer remaining (${formatMinor(refundableMinor, currency)})`}
        </button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block text-white/50">
          Partial refund (minor units, max {refundableMinor})
          <input
            value={partialMinor}
            onChange={(e) => setPartialMinor(e.target.value.replace(/\D/g, ""))}
            className="mt-1 w-40 rounded-lg border border-white/15 bg-black/20 px-3 py-2 font-mono text-sm text-white"
            disabled={Boolean(busy) || refundableMinor <= 0}
          />
        </label>
        <button
          type="button"
          disabled={Boolean(busy) || refundableMinor <= 0}
          onClick={() => {
            const n = Math.floor(Number(partialMinor) || 0);
            void resolve("RESOLVED_SPLIT", {
              refundMinor: n,
              releaseRemaining: false,
            });
          }}
          className="rounded-lg border border-amber-400/40 px-3 py-1.5 text-xs text-amber-100 disabled:opacity-50"
        >
          {busy === "RESOLVED_SPLIT" ? "Applying…" : "Partial refund only"}
        </button>
        <button
          type="button"
          disabled={Boolean(busy) || refundableMinor <= 0}
          onClick={() => {
            const n = Math.floor(Number(partialMinor) || 0);
            void resolve("RESOLVED_SPLIT", {
              refundMinor: n,
              releaseRemaining: true,
            });
          }}
          className="rounded-lg border border-amber-400/40 px-3 py-1.5 text-xs text-amber-100 disabled:opacity-50"
        >
          Partial refund + release rest
        </button>
      </div>
      <p className="text-white/35">
        Server clamps refunds to platform-held remainder. Already-released item
        funds are never reversed automatically.
      </p>
      {error ? <p className="text-amber-200/90">{error}</p> : null}
    </div>
  );
}
