"use client";

import { useState } from "react";

/**
 * Records the LIVE GBP Dashboard statement only after the admin presses the button.
 * Rendering this control does not call the confirmation route.
 */
export default function ConfirmLiveGbpBankButton({
  statement,
  evidence,
}: {
  statement: string;
  evidence: string;
}) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function recordConfirmation() {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/platform-bank-dashboard-confirmation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stripeMode: "LIVE", currency: "GBP", evidence, statement }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(body?.error || "Confirmation was not recorded");
        return;
      }
      setMessage(
        body?.recorded
          ? "LIVE GBP Dashboard confirmation recorded. Bank verification is still false, and no payout was enabled."
          : "Confirmation was not recorded",
      );
    } catch {
      setMessage("Confirmation was not recorded");
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
        onClick={recordConfirmation}
      >
        {pending ? "Recording…" : "Record LIVE GBP Dashboard confirmation"}
      </button>
      {message ? <p className="mt-4 text-sm text-white/80">{message}</p> : null}
    </div>
  );
}
