"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMinor } from "@/lib/payments/money";

type OutboundRow = {
  id: string;
  protectedTxnId: string;
  kind: string;
  amountMinor: number;
  currency: string;
  status: string;
  stripeOutboundPaymentId: string;
  failureCode: string;
  failureMessage: string;
  reconciliationNote: string;
  displayLabel?: string;
  needsAdminAction?: boolean;
  pendingProvider?: boolean;
  lastAttemptAt?: string;
};

type CombineGroup = {
  sellerId: string;
  currency: string;
  stripeMode: string;
  count: number;
  combinedMinor: number;
  attemptIds: string[];
};

/**
 * Admin GP queue: stuck PROCESSING reconcile + issue visibility.
 * Reconcile retrieves Stripe state only — never creates OutboundPayments.
 */
export default function GpReconcilePanel() {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [issues, setIssues] = useState<OutboundRow[]>([]);
  const [stuck, setStuck] = useState<OutboundRow[]>([]);
  const [combineGroups, setCombineGroups] = useState<CombineGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/payments/gp-reconcile", {
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as {
        enabled?: boolean;
        issues?: OutboundRow[];
        stuck?: OutboundRow[];
        combineGroups?: CombineGroup[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || "Could not load GP queue");
      }
      setEnabled(Boolean(data.enabled));
      setIssues(data.issues || []);
      setStuck(data.stuck || []);
      setCombineGroups(data.combineGroups || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function reconcileOne(attemptId: string) {
    setBusy(attemptId);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/admin/payments/gp-reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reconcile_one",
          attemptId,
          confirmed: true,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        result?: { action?: string };
      };
      if (!res.ok) {
        throw new Error(data.error || "Reconcile failed");
      }
      setInfo(`Reconcile: ${data.result?.action || "ok"}`);
      await load();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reconcile failed");
    } finally {
      setBusy(null);
    }
  }

  async function reconcileStuckBatch() {
    setBusy("batch");
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/admin/payments/gp-reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reconcile_stuck",
          confirmed: true,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        scanned?: number;
      };
      if (!res.ok) {
        throw new Error(data.error || "Batch reconcile failed");
      }
      setInfo(`Scanned ${data.scanned ?? 0} stuck PROCESSING attempt(s)`);
      await load();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Batch reconcile failed");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <section className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <p className="text-sm text-white/50">Loading Global Payouts queue…</p>
      </section>
    );
  }

  if (!enabled) return null;

  return (
    <section className="mt-8 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl text-white">Global Payouts queue</h2>
          <p className="mt-1 text-sm text-white/55">
            Retrieve-only reconcile for stuck processing. Returned payouts need
            manual review — never auto-repay.
          </p>
        </div>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void reconcileStuckBatch()}
          className="rounded-lg bg-electric/90 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink disabled:opacity-50"
        >
          {busy === "batch" ? "Reconciling…" : "Reconcile stuck"}
        </button>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-rose-300" role="alert">
          {error}
        </p>
      ) : null}
      {info ? (
        <p className="mt-3 text-sm text-emerald-300">{info}</p>
      ) : null}

      {stuck.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
            Stuck PROCESSING
          </h3>
          <ul className="mt-2 space-y-2">
            {stuck.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-sm"
              >
                <div>
                  <p className="text-white/85">
                    {row.kind} · {formatMinor(row.amountMinor, row.currency)} ·{" "}
                    {row.displayLabel || row.status}
                  </p>
                  <p className="text-xs text-white/45">
                    txn {row.protectedTxnId.slice(0, 10)}… · last{" "}
                    {row.lastAttemptAt
                      ? new Date(row.lastAttemptAt).toLocaleString()
                      : "—"}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void reconcileOne(row.id)}
                  className="rounded-md border border-white/20 px-2 py-1 text-xs text-white/80 hover:bg-white/5 disabled:opacity-50"
                >
                  {busy === row.id ? "…" : "Reconcile"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-4 text-sm text-white/45">No stuck PROCESSING attempts.</p>
      )}

      {issues.length > 0 ? (
        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
            Issues / review
          </h3>
          <ul className="mt-2 space-y-2">
            {issues.slice(0, 20).map((row) => (
              <li
                key={row.id}
                className="rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-sm"
              >
                <p className="text-white/85">
                  {row.kind} · {formatMinor(row.amountMinor, row.currency)} ·{" "}
                  {row.displayLabel || row.status}
                </p>
                <p className="text-xs text-white/45">
                  {row.failureCode || "—"}
                  {row.failureMessage ? ` · ${row.failureMessage.slice(0, 120)}` : ""}
                </p>
                {row.reconciliationNote ? (
                  <p className="mt-1 text-xs text-amber-200/80">
                    {row.reconciliationNote.slice(0, 160)}
                  </p>
                ) : null}
                {row.status === "PROCESSING" || row.status === "FAILED" ? (
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void reconcileOne(row.id)}
                    className="mt-2 rounded-md border border-white/20 px-2 py-1 text-xs text-white/80 hover:bg-white/5 disabled:opacity-50"
                  >
                    {busy === row.id ? "…" : "Reconcile"}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {combineGroups.some((g) => g.count > 1) ? (
        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">
            Combine-minimum groups (manual)
          </h3>
          <p className="mt-1 text-xs text-white/45">
            Multi-row below-minimum groups need admin-assisted combine — auto
            multi-payment combine is not enabled.
          </p>
          <ul className="mt-2 space-y-1 text-sm text-white/70">
            {combineGroups
              .filter((g) => g.count > 1)
              .map((g) => (
                <li key={`${g.sellerId}-${g.currency}-${g.stripeMode}`}>
                  {g.count} · {formatMinor(g.combinedMinor, g.currency)} ·{" "}
                  {g.stripeMode}
                </li>
              ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
