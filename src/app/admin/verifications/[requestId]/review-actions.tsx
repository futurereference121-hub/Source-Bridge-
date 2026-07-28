"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const REASONS = [
  "Document image is unclear",
  "Selfie does not clearly match the document",
  "Document appears expired",
  "Required image is missing",
  "Document information cannot be verified",
  "Unsupported document",
  "Other",
] as const;

export default function ReviewActions({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [preset, setPreset] = useState<(typeof REASONS)[number] | "">(
    "",
  );
  const [custom, setCustom] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function rejectionReason() {
    if (preset === "Other") return custom.trim();
    if (preset) {
      return custom.trim()
        ? `${preset}. ${custom.trim()}`
        : preset;
    }
    return custom.trim();
  }

  async function review(action: "approve" | "reject") {
    setError("");
    if (action === "approve") {
      if (
        !window.confirm(
          "Approve this identity verification? The applicant will receive a Verified badge.",
        )
      ) {
        return;
      }
    }
    if (action === "reject" && !rejectionReason()) {
      setError("A rejection reason is required");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/verifications/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          rejectionReason: action === "reject" ? rejectionReason() : undefined,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(json.error || "Review failed");
        return;
      }
      router.push("/admin/verifications");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 max-w-xl space-y-4 rounded-xl border border-white/10 bg-white/5 p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/45">
        Decision
      </p>
      <div className="space-y-2">
        {REASONS.map((reason) => (
          <label
            key={reason}
            className="flex cursor-pointer items-center gap-2 text-sm text-white/75"
          >
            <input
              type="radio"
              name="reason"
              checked={preset === reason}
              onChange={() => setPreset(reason)}
            />
            {reason}
          </label>
        ))}
      </div>
      <textarea
        value={custom}
        onChange={(event) => setCustom(event.target.value)}
        placeholder="Additional explanation (required when Other is selected)"
        className="w-full rounded-lg border border-white/15 bg-transparent p-3 text-sm text-white outline-none focus:border-electric/50"
        rows={3}
      />
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void review("approve")}
          className="rounded-lg bg-emerald-400 px-4 py-2 font-medium text-app-navy disabled:opacity-50"
        >
          Approve
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void review("reject")}
          className="rounded-lg bg-red-400 px-4 py-2 font-medium text-app-navy disabled:opacity-50"
        >
          Decline
        </button>
      </div>
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
    </div>
  );
}
