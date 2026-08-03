"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Loader2, ShieldCheck } from "lucide-react";

type ProposePaymentTicketButtonProps = {
  conversationId: string;
  myId: string;
  onCreated?: () => void;
};

/**
 * Compact composer action to propose a Payment Ticket (no funding).
 * Fees are recalculated server-side.
 */
export function ProposePaymentTicketButton({
  conversationId,
  myId,
  onCreated,
}: ProposePaymentTicketButtonProps) {
  const [open, setOpen] = useState(false);
  const [itemMajor, setItemMajor] = useState("");
  const [shippingMajor, setShippingMajor] = useState("0");
  const [title, setTitle] = useState("");
  const [procurement, setProcurement] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    void fetch("/api/payments/connect")
      .then((r) => r.json())
      .then((j: { flags?: { PROTECTED_PAYMENTS_ENABLED?: boolean; INSTANT_PAYMENTS_ENABLED?: boolean } }) => {
        setEnabled(
          Boolean(
            j.flags?.PROTECTED_PAYMENTS_ENABLED ||
              j.flags?.INSTANT_PAYMENTS_ENABLED,
          ),
        );
      })
      .catch(() => setEnabled(false));
  }, []);

  if (!enabled) return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const item = Math.round(Number(itemMajor) * 100);
    const shipping = Math.round(Number(shippingMajor || "0") * 100);
    if (!Number.isFinite(item) || item <= 0) {
      setError("Enter a valid item cost");
      setBusy(false);
      return;
    }
    try {
      const res = await fetch("/api/payments/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          itemCostMinor: item,
          shippingMinor: Number.isFinite(shipping) ? Math.max(0, shipping) : 0,
          title: title || undefined,
          paymentOption: "PROTECTED",
          procurementAdvanceAgreed: procurement,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(json.error || "Could not create ticket");
      } else {
        setOpen(false);
        setItemMajor("");
        setShippingMajor("0");
        setTitle("");
        setProcurement(false);
        onCreated?.();
      }
    } catch {
      setError("Could not create ticket");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-electric/40 px-2.5 py-1.5 text-[11px] font-medium text-electric hover:bg-electric/10"
        title="Propose Protected Payment"
      >
        <ShieldCheck size={14} />
        Payment Ticket
      </button>
      {open ? (
        <form
          onSubmit={onSubmit}
          className="absolute bottom-full left-0 z-20 mb-2 w-72 rounded-xl border border-white/15 bg-[#061228] p-3 shadow-xl"
        >
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-electric">
            Protected Payment
          </p>
          <p className="mt-1 text-[11px] text-white/45">
            Both parties must accept the same terms before payment. Fees are
            calculated by Source Bridge.
          </p>
          <label className="mt-3 block text-[11px] text-white/55">
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-md border border-white/15 bg-transparent px-2 py-1.5 text-sm text-white"
              placeholder="Optional"
            />
          </label>
          <label className="mt-2 block text-[11px] text-white/55">
            Item cost (USD)
            <input
              value={itemMajor}
              onChange={(e) => setItemMajor(e.target.value)}
              inputMode="decimal"
              required
              className="mt-1 w-full rounded-md border border-white/15 bg-transparent px-2 py-1.5 text-sm text-white"
              placeholder="0.00"
            />
          </label>
          <label className="mt-2 block text-[11px] text-white/55">
            Shipping (USD)
            <input
              value={shippingMajor}
              onChange={(e) => setShippingMajor(e.target.value)}
              inputMode="decimal"
              className="mt-1 w-full rounded-md border border-white/15 bg-transparent px-2 py-1.5 text-sm text-white"
            />
          </label>
          <label className="mt-3 flex items-center gap-2 text-[11px] text-white/60">
            <input
              type="checkbox"
              checked={procurement}
              onChange={(e) => setProcurement(e.target.checked)}
            />
            Request procurement advance (Item Cost, if eligible)
          </label>
          {error ? <p className="mt-2 text-[11px] text-amber-300">{error}</p> : null}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md px-2 py-1 text-[11px] text-white/50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md bg-electric px-2.5 py-1 text-[11px] font-medium text-app-navy disabled:opacity-50"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : null}
              Propose
            </button>
          </div>
          <p className="sr-only">{myId}</p>
        </form>
      ) : null}
    </div>
  );
}
