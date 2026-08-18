"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  disputeId: string;
  role: "BUYER" | "SELLER";
  label: string;
};

export default function AdminDisputeMessageLink({
  disputeId,
  role,
  label,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function openThread() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/payments/issues/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disputeId, role }),
      });
      if (!res.ok) return;
      router.push(`/admin/reviews/${disputeId}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void openThread()}
      className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-electric hover:text-electric-hover disabled:opacity-50"
    >
      {busy ? "Opening…" : label}
    </button>
  );
}
