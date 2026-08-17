"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMinor } from "@/lib/payments/money";

type Candidate = {
  id: string;
  status: string;
  title: string;
  currency: string;
  shippedAt: string | null;
  windowEndsAt: string | null;
  residualMinor: number;
  buyer: { id: string; username: string | null; name: string };
  seller: { id: string; username: string | null; name: string };
};

type Props = {
  windowHours?: number;
};

export default function InactivityReleasePanel({ windowHours = 72 }: Props) {
  const router = useRouter();
  const [eligible, setEligible] = useState<Candidate[]>([]);
  const [hours, setHours] = useState(windowHours);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/admin/payments/inactivity-release", {
          cache: "no-store",
        });
        const data = (await res.json().catch(() => ({}))) as {
          eligible?: Candidate[];
          windowHours?: number;
        };
        if (cancelled) return;
        setEligible(data.eligible || []);
        if (typeof data.windowHours === "number") setHours(data.windowHours);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function authorize(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/admin/payments/inactivity-release", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protectedTxnId: id, confirmed: true }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || `Failed (${res.status})`);
        return;
      }
      setConfirmId(null);
      setEligible((prev) => prev.filter((r) => r.id !== id));
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mt-10">
      <h2 className="text-lg font-semibold">Buyer inactivity release</h2>
      <p className="mt-1 text-sm text-white/50">
        TEST window: {hours} hours after shipment with no buyer receipt.
        Admin-authorized only — sellers cannot self-release, and cron does not
        auto-release on this path.
      </p>
      <div className="mt-4 space-y-3">
        {loading ? (
          <p className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/40">
            Loading inactivity candidates…
          </p>
        ) : eligible.length === 0 ? (
          <p className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/40">
            No listing sales currently past the inactivity window.
          </p>
        ) : (
          eligible.map((row) => (
            <div
              key={row.id}
              className="rounded-xl border border-white/10 bg-white/5 p-4"
            >
              <p className="font-medium text-white">{row.title}</p>
              <p className="mt-1 font-mono text-xs text-white/45">{row.id}</p>
              <p className="mt-1 text-xs text-white/50">
                Residual {formatMinor(row.residualMinor, row.currency)} · shipped{" "}
                {row.shippedAt ? new Date(row.shippedAt).toLocaleString() : "—"}
              </p>
              {confirmId === row.id ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    onClick={() => void authorize(row.id)}
                    className="rounded-lg bg-electric px-3 py-1.5 text-xs font-medium text-app-navy disabled:opacity-50"
                  >
                    {busyId === row.id ? "Releasing…" : "Confirm admin release"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmId(null)}
                    className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/70"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmId(row.id)}
                  className="mt-3 rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white"
                >
                  Authorize release after buyer inactivity
                </button>
              )}
            </div>
          ))
        )}
      </div>
      {error ? <p className="mt-2 text-xs text-amber-200/90">{error}</p> : null}
    </div>
  );
}
