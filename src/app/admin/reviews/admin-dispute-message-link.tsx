"use client";

import { useState } from "react";
import AdminDisputeMessenger from "./admin-dispute-messenger";

type Props = {
  disputeId: string;
  role: "BUYER" | "SELLER";
  label: string;
  adminUserId?: string;
};

/**
 * Opens the private dispute thread in place — no navigation to the slow
 * /admin/reviews/[id] page.
 */
export default function AdminDisputeMessageLink({
  disputeId,
  role,
  label,
  adminUserId = "admin",
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function ensureThread() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/payments/issues/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disputeId, role }),
      });
      if (!res.ok) {
        setError("Could not open support thread");
        return;
      }
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full min-w-0">
      <button
        type="button"
        disabled={busy}
        onClick={() => void (open ? setOpen(false) : ensureThread())}
        className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-electric hover:text-electric-hover disabled:opacity-50"
      >
        {busy ? "Opening…" : open ? `Hide · ${label}` : label}
      </button>
      {error ? <p className="mt-1 text-[11px] text-amber-300">{error}</p> : null}
      {open ? (
        <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-3">
          <AdminDisputeMessenger
            disputeId={disputeId}
            role={role}
            label={label}
            adminUserId={adminUserId}
          />
        </div>
      ) : null}
    </div>
  );
}
