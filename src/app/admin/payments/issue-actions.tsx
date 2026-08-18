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
  sellerEntitledMinor?: number;
  alreadyReleasedMinor?: number;
  protectedRemainingMinor?: number;
};

export default function PaymentIssueActions({
  disputeId,
  currency,
  finalResidualMinor,
  refundableMinor,
  sellerEntitledMinor = 0,
  alreadyReleasedMinor = 0,
  protectedRemainingMinor = refundableMinor,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refundMajor, setRefundMajor] = useState(
    refundableMinor > 0
      ? minorToMajor(refundableMinor, currency).toFixed(2)
      : "0.00",
  );
  const [releaseMajor, setReleaseMajor] = useState(
    finalResidualMinor > 0
      ? minorToMajor(finalResidualMinor, currency).toFixed(2)
      : "0.00",
  );
  const [note, setNote] = useState("");
  const [confirmText, setConfirmText] = useState<string | null>(null);

  const refundMinor = useMemo(
    () => parseHumanAmountToMinor(refundMajor, currency) ?? 0,
    [refundMajor, currency],
  );
  const releaseMinor = useMemo(
    () => parseHumanAmountToMinor(releaseMajor, currency) ?? 0,
    [releaseMajor, currency],
  );
  const allocatedMinor = refundMinor + releaseMinor;
  const remainingAfterAlloc = Math.max(0, protectedRemainingMinor - allocatedMinor);

  function askConfirm() {
    setError(null);
    if (refundMinor <= 0 && releaseMinor <= 0) {
      setError("Enter a refund and/or a sourcer release amount.");
      return;
    }
    if (refundMinor > refundableMinor) {
      setError(
        `Refund cannot exceed ${formatMinor(refundableMinor, currency)} (max refundable).`,
      );
      return;
    }
    if (releaseMinor > 0 && releaseMinor > finalResidualMinor) {
      setError(
        `Sourcer release cannot exceed remaining entitlement ${formatMinor(finalResidualMinor, currency)}.`,
      );
      return;
    }
    if (allocatedMinor > protectedRemainingMinor) {
      setError(
        `Allocated total cannot exceed available controlled ${formatMinor(protectedRemainingMinor, currency)}.`,
      );
      return;
    }
    const parts: string[] = [];
    if (refundMinor > 0) {
      parts.push(`refund the buyer ${formatMinor(refundMinor, currency)} via the original payment`);
    }
    if (releaseMinor > 0) {
      parts.push(
        `release ${formatMinor(releaseMinor, currency)} to the sourcer Connect account`,
      );
    }
    setConfirmText(`Confirm: ${parts.join(" and ")}? Server recalculates books before money moves.`);
  }

  async function execute() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const willRefund = refundMinor > 0;
      const willRelease = releaseMinor > 0;
      const resolution =
        willRefund && willRelease
          ? "RESOLVED_SPLIT"
          : willRefund
            ? "RESOLVED_BUYER"
            : "RESOLVED_SELLER";
      const res = await fetch("/api/admin/payments/issues", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          disputeId,
          resolution,
          resolutionNote: note.trim() || undefined,
          refundMinor: willRefund ? refundMinor : undefined,
          releaseMinor: willRelease ? releaseMinor : undefined,
          confirmed: true,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || `Failed (${res.status})`);
        return;
      }
      setConfirmText(null);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-3 border-t border-white/10 pt-3 text-xs">
      <dl className="grid gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-white/40">Available controlled (platform held)</dt>
          <dd>{formatMinor(protectedRemainingMinor, currency)}</dd>
        </div>
        <div>
          <dt className="text-white/40">Already released to sourcer</dt>
          <dd>{formatMinor(alreadyReleasedMinor, currency)}</dd>
        </div>
        <div>
          <dt className="text-white/40">Max refundable to buyer</dt>
          <dd>{formatMinor(refundableMinor, currency)}</dd>
        </div>
        <div>
          <dt className="text-white/40">Remaining sourcer entitlement</dt>
          <dd>{formatMinor(finalResidualMinor, currency)}</dd>
        </div>
        {sellerEntitledMinor > 0 ? (
          <div>
            <dt className="text-white/40">Sourcer entitled (gross)</dt>
            <dd>{formatMinor(sellerEntitledMinor, currency)}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-white/40">Allocated now / remaining after</dt>
          <dd>
            {formatMinor(allocatedMinor, currency)} /{" "}
            {formatMinor(remainingAfterAlloc, currency)}
          </dd>
        </div>
      </dl>
      <p className="text-white/35">
        Amounts are sent to the server as typed minor units; the server
        recalculates books and refuses anything above remaining entitlement.
        Buyer refunds use the original PaymentIntent — the buyer does not need
        Stripe Connect. Sourcer releases go to that sourcer&apos;s Connect
        account.
      </p>
      <label className="block text-white/50">
        Admin note (optional)
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white"
          maxLength={2000}
          disabled={busy}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-white/50">
          REFUND BUYER {formatMinor(refundableMinor, currency)}
          <input
            value={refundMajor}
            onChange={(e) => setRefundMajor(e.target.value)}
            inputMode="decimal"
            className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white"
            disabled={busy || refundableMinor <= 0}
            placeholder="0.00"
          />
        </label>
        <label className="block text-white/50">
          RELEASE TO SOURCER {formatMinor(finalResidualMinor, currency)}
          <input
            value={releaseMajor}
            onChange={(e) => setReleaseMajor(e.target.value)}
            inputMode="decimal"
            className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white"
            disabled={busy || finalResidualMinor <= 0}
            placeholder="0.00"
          />
        </label>
      </div>
      {!confirmText ? (
        <div className="flex flex-wrap gap-2">
          {refundableMinor > 0 ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setRefundMajor(minorToMajor(refundableMinor, currency).toFixed(2));
                setReleaseMajor("0.00");
              }}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:border-electric/40"
            >
              Refund buyer (max {formatMinor(refundableMinor, currency)})
            </button>
          ) : null}
          {finalResidualMinor > 0 ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setReleaseMajor(minorToMajor(finalResidualMinor, currency).toFixed(2));
                setRefundMajor("0.00");
              }}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:border-electric/40"
            >
              Release to sourcer (max {formatMinor(finalResidualMinor, currency)})
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={askConfirm}
            className="rounded-lg bg-electric px-3 py-1.5 text-xs font-medium text-app-navy disabled:opacity-50"
          >
            Review confirmation
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-3 text-amber-50">
          <p>{confirmText}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void execute()}
              className="rounded-lg bg-electric px-3 py-1.5 text-xs font-medium text-app-navy disabled:opacity-50"
            >
              {busy ? "Working…" : "Confirm resolution"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmText(null)}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/70"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error ? <p className="text-amber-200/90">{error}</p> : null}
    </div>
  );
}
