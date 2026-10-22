"use client";

import { useState } from "react";

/**
 * Runs the flags-off coordination warmup. It does not enable payouts or change
 * the daily Stripe schedule.
 */
export default function PlatformBalanceWarmupButton() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function runWarmup() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/platform-balance-warmup", { method: "POST" });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(body?.error || "Warmup did not complete");
        return;
      }
      const testCode = Array.isArray(body?.TEST?.currencies)
        ? body.TEST.currencies.map((row: { currency?: string; code?: string }) => `${row.currency}:${row.code}`).join(", ")
        : body?.TEST?.skipped || "none";
      const liveCode = Array.isArray(body?.LIVE?.currencies)
        ? body.LIVE.currencies.map((row: { currency?: string; code?: string }) => `${row.currency}:${row.code}`).join(", ")
        : body?.LIVE?.skipped || "none";
      setMessage(`Warmup recorded. TEST ${testCode || "none"}. LIVE ${liveCode || "none"}. Inspect GET /api/admin/platform-balance-monitor for lastWarmupAt vs lastSuccessAt.`);
    } catch {
      setMessage("Warmup did not complete");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        className="rounded-lg bg-electric px-4 py-2 font-medium text-app-navy disabled:opacity-60"
        disabled={pending}
        onClick={runWarmup}
      >
        {pending ? "Running warmup…" : "Run TEST and LIVE coordination warmup"}
      </button>
      {message ? <p className="mt-4 text-sm text-white/80">{message}</p> : null}
    </div>
  );
}
