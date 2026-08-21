"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  formatMinor,
  minorToMajor,
  parseHumanAmountToMinor,
} from "@/lib/payments/money";

type Props = {
  /** When set, resolve via dispute issues API (closes dispute). */
  disputeId?: string;
  /** When set (no open dispute), resolve via protected-txns API. */
  protectedTxnId?: string;
  currency: string;
  totalPaidMinor: number;
  finalResidualMinor: number;
  refundableMinor: number;
  platformFeeMinor: number;
  platformFeeRefundedMinor?: number;
  sellerEntitledMinor?: number;
  alreadyReleasedMinor?: number;
  protectedRemainingMinor?: number;
  /** Read-only audit ids after resolution (P20). */
  lastRefundId?: string | null;
  lastTransferId?: string | null;
};

export default function PaymentIssueActions({
  disputeId,
  protectedTxnId,
  currency,
  totalPaidMinor,
  finalResidualMinor,
  refundableMinor,
  platformFeeMinor,
  platformFeeRefundedMinor = 0,
  sellerEntitledMinor = 0,
  alreadyReleasedMinor = 0,
  protectedRemainingMinor = refundableMinor,
  lastRefundId = null,
  lastTransferId = null,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const feeStillOnPlatform = Math.max(
    0,
    Math.min(platformFeeMinor - platformFeeRefundedMinor, protectedRemainingMinor),
  );
  const maxRefundExcludingFee = Math.max(0, protectedRemainingMinor - feeStillOnPlatform);
  const [includePlatformFee, setIncludePlatformFee] = useState(false);
  const maxRefundable = includePlatformFee ? refundableMinor : maxRefundExcludingFee;

  const [refundMajor, setRefundMajor] = useState(
    maxRefundable > 0
      ? minorToMajor(maxRefundable, currency).toFixed(2)
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
    if (refundMinor > maxRefundable) {
      setError(
        `Refund cannot exceed ${formatMinor(maxRefundable, currency)}${includePlatformFee ? " (includes SB fee)" : " (excludes SB fee)"}.`,
      );
      return;
    }
    if (releaseMinor > 0 && releaseMinor > finalResidualMinor) {
      setError(
        `Sourcer release cannot exceed remaining seller funds ${formatMinor(finalResidualMinor, currency)}.`,
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
      parts.push(
        `refund the buyer ${formatMinor(refundMinor, currency)} via the original payment${includePlatformFee ? " (may include Source Bridge fee)" : ""}`,
      );
    }
    if (releaseMinor > 0) {
      parts.push(
        `release ${formatMinor(releaseMinor, currency)} to the seller Connect account`,
      );
    }
    setConfirmText(`Confirm decision: ${parts.join(" and ")}? Server recalculates books before money moves.`);
  }

  async function execute() {
    if (busy) return;
    if (!disputeId && !protectedTxnId) {
      setError("Missing dispute or protected transaction id.");
      return;
    }
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
      const endpoint = disputeId
        ? "/api/admin/payments/issues"
        : "/api/admin/payments/protected-txns";
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(disputeId ? { disputeId } : { protectedTxnId }),
          resolution,
          resolutionNote: note.trim() || undefined,
          refundMinor: willRefund ? refundMinor : undefined,
          releaseMinor: willRelease ? releaseMinor : undefined,
          includePlatformFeeInRefund: includePlatformFee,
          confirmed: true,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        refundId?: string;
        transferId?: string;
      };
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
      <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="font-semibold uppercase tracking-[0.12em] text-white/45">
            Total paid
          </dt>
          <dd className="text-sm text-white">{formatMinor(totalPaidMinor, currency)}</dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-[0.12em] text-white/45">
            Already released
          </dt>
          <dd className="text-sm text-white">
            {formatMinor(alreadyReleasedMinor, currency)}
          </dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-[0.12em] text-white/45">
            Remaining seller funds
          </dt>
          <dd className="text-sm text-white">
            {formatMinor(finalResidualMinor, currency)}
          </dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-[0.12em] text-electric/80">
            SB fee (held)
          </dt>
          <dd className="text-sm text-white">
            {formatMinor(feeStillOnPlatform, currency)}
            {platformFeeRefundedMinor > 0 ? (
              <span className="ml-1 text-white/45">
                · refunded {formatMinor(platformFeeRefundedMinor, currency)}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-[0.12em] text-white/45">
            Safely refundable
          </dt>
          <dd className="text-sm text-white">
            {formatMinor(refundableMinor, currency)}
          </dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-[0.12em] text-white/45">
            Platform controlled
          </dt>
          <dd className="text-sm text-white">
            {formatMinor(protectedRemainingMinor, currency)}
          </dd>
        </div>
        {sellerEntitledMinor > 0 ? (
          <div>
            <dt className="font-semibold uppercase tracking-[0.12em] text-white/45">
              Sourcer entitled (gross)
            </dt>
            <dd className="text-sm text-white">
              {formatMinor(sellerEntitledMinor, currency)}
            </dd>
          </div>
        ) : null}
      </dl>

      <label className="flex items-center gap-2 text-white/60">
        <input
          type="checkbox"
          checked={includePlatformFee}
          onChange={(e) => {
            setIncludePlatformFee(e.target.checked);
            if (!e.target.checked && refundMinor > maxRefundExcludingFee) {
              setRefundMajor(
                maxRefundExcludingFee > 0
                  ? minorToMajor(maxRefundExcludingFee, currency).toFixed(2)
                  : "0.00",
              );
            }
          }}
          disabled={busy || feeStillOnPlatform <= 0}
          className="rounded border-white/30"
        />
        Include Source Bridge fee in buyer refund (up to{" "}
        {formatMinor(feeStillOnPlatform, currency)})
      </label>

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
          REFUND BUYER £ (max {formatMinor(maxRefundable, currency)})
          <input
            value={refundMajor}
            onChange={(e) => setRefundMajor(e.target.value)}
            inputMode="decimal"
            className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white"
            disabled={busy || maxRefundable <= 0}
            placeholder="0.00"
          />
        </label>
        <label className="block text-white/50">
          RELEASE TO SELLER £ (max {formatMinor(finalResidualMinor, currency)})
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
          {maxRefundable > 0 ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setRefundMajor(minorToMajor(maxRefundable, currency).toFixed(2));
                setReleaseMajor("0.00");
              }}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:border-electric/40"
            >
              Refund buyer (max {formatMinor(maxRefundable, currency)})
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
              Release to seller (max {formatMinor(finalResidualMinor, currency)})
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={askConfirm}
            className="rounded-lg bg-electric px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-app-navy disabled:opacity-50"
          >
            Confirm decision
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
      {(lastRefundId || lastTransferId) ? (
        <details className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white/55">
          <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
            Advanced / audit
          </summary>
          <dl className="mt-2 space-y-1 font-mono text-[11px]">
            {lastRefundId ? (
              <div>
                <dt className="text-white/35">Refund ID</dt>
                <dd>{lastRefundId}</dd>
              </div>
            ) : null}
            {lastTransferId ? (
              <div>
                <dt className="text-white/35">Transfer ID</dt>
                <dd>{lastTransferId}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-white/35">Allocated / remaining</dt>
              <dd>
                {formatMinor(allocatedMinor, currency)} /{" "}
                {formatMinor(remainingAfterAlloc, currency)}
              </dd>
            </div>
          </dl>
        </details>
      ) : (
        <details className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-white/45">
          <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
            Advanced / audit
          </summary>
          <p className="mt-2 text-[11px] leading-relaxed">
            Buyer refunds use the original PaymentIntent. Sourcer releases go to
            that sourcer&apos;s Connect account. Refund and Transfer IDs appear
            here after confirmation.
          </p>
        </details>
      )}
    </div>
  );
}
