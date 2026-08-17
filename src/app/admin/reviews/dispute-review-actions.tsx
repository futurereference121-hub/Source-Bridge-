"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  disputeId: string;
  status: string;
  adminNotes?: string;
};

export default function DisputeReviewActions({
  disputeId,
  status,
  adminNotes = "",
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState(adminNotes);

  async function markUnderReview() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/payments/issues/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          disputeId,
          status: "UNDER_REVIEW",
          adminNotes: notes.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || `Failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  if (status !== "OPEN") return null;

  return (
    <div className="mt-3 space-y-2 border-t border-white/10 pt-3 text-xs">
      <label className="block text-white/50">
        Internal admin notes
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-1 w-full rounded-lg border border-white/15 bg-black/20 px-3 py-2 text-sm text-white"
          rows={2}
          maxLength={4000}
          disabled={busy}
        />
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={() => void markUnderReview()}
        className="rounded-lg border border-white/25 px-3 py-1.5 text-xs text-white disabled:opacity-50"
      >
        {busy ? "Updating…" : "Mark under review"}
      </button>
      {error ? <p className="text-amber-200/90">{error}</p> : null}
    </div>
  );
}
