"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { formatMinor } from "@/lib/payments/money";
import { ProtectedPaymentCheckout } from "@/components/payments/ProtectedPaymentCheckout";

export type PaymentTicketView = {
  id: string;
  status: string;
  revision: number;
  termsHash: string;
  title: string;
  currency: string;
  itemCostMinor: number;
  shippingMinor: number;
  sellerServiceFeeMinor: number;
  protectionFeeMinor: number;
  totalChargeMinor: number;
  paymentOption: string;
  procurementAdvanceAgreed: boolean;
  procurementAdvanceMinor: number;
  buyerId: string;
  sellerId: string;
  buyerApprovedRevision: number | null;
  sellerApprovedRevision: number | null;
  protectedTransactionId: string | null;
  breakdown: {
    labels: {
      itemCost: string;
      shipping: string;
      sellerServiceFee: string;
      sourceBridgeProtectionFee: string;
    };
  };
};

type Props = {
  ticketId: string;
  myId: string;
  onChanged?: () => void;
};

export function PaymentTicketCard({ ticketId, myId, onChanged }: Props) {
  const [ticket, setTicket] = useState<PaymentTicketView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [payNotice, setPayNotice] = useState("");
  const [checkout, setCheckout] = useState<{
    clientSecret: string;
    publishableKey: string;
    amountMinor: number;
    currency: string;
  } | null>(null);
  const [paymentsAccess, setPaymentsAccess] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/payments/tickets/${ticketId}`);
      const json = (await res.json()) as {
        ok?: boolean;
        ticket?: PaymentTicketView;
        error?: string;
      };
      if (!res.ok || !json.ticket) {
        setError(json.error || "Could not load Payment Ticket");
        setTicket(null);
      } else {
        setTicket(json.ticket);
      }
    } catch {
      setError("Could not load Payment Ticket");
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void fetch("/api/payments/connect")
      .then((r) => r.json())
      .then(
        (j: {
          paymentsAccess?: { testAccessAllowed?: boolean };
          flags?: { PAYMENTS_ENABLED?: boolean };
        }) => {
          setPaymentsAccess(
            Boolean(
              j.flags?.PAYMENTS_ENABLED && j.paymentsAccess?.testAccessAllowed,
            ),
          );
        },
      )
      .catch(() => setPaymentsAccess(false));
  }, []);

  // After return from 3DS: poll — funding only when webhook sets FUNDED.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") !== "return") return;
    let n = 0;
    const id = window.setInterval(() => {
      n += 1;
      void load();
      if (n >= 12) window.clearInterval(id);
    }, 2500);
    return () => window.clearInterval(id);
  }, [load]);

  async function respond(action: "accept" | "decline") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/payments/tickets/${ticketId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        ticket?: PaymentTicketView;
        error?: string;
      };
      if (!res.ok || !json.ticket) {
        setError(json.error || "Action failed");
      } else {
        setTicket(json.ticket);
        onChanged?.();
      }
    } catch {
      setError("Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function startPay() {
    if (!ticket?.protectedTransactionId) return;
    setBusy(true);
    setPayNotice("");
    setError("");
    setCheckout(null);
    try {
      const isDirect =
        ticket.paymentOption === "INSTANT" || ticket.paymentOption === "DIRECT";
      const res = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protectedTxnId: ticket.protectedTransactionId,
          idempotencyKey: `pay_${ticket.id}_${ticket.termsHash}_${isDirect ? "dest_v1" : "prot_v1"}`,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        clientSecret?: string;
        publishableKey?: string;
        amountMinor?: number;
        currency?: string;
      };
      if (!res.ok) {
        setError(json.error || "Checkout unavailable");
      } else if (json.clientSecret && json.publishableKey) {
        setCheckout({
          clientSecret: json.clientSecret,
          publishableKey: json.publishableKey,
          amountMinor: json.amountMinor ?? ticket.totalChargeMinor,
          currency: json.currency ?? ticket.currency,
        });
        setPayNotice(
          "Complete payment below. Status updates after Stripe confirms (do not pay again).",
        );
      } else {
        setError("Checkout did not return a payment form");
      }
    } catch {
      setError("Checkout failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/50">
        <Loader2 size={16} className="animate-spin" /> Loading Payment Ticket…
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/50">
        {error || "Payment Ticket unavailable"}
      </div>
    );
  }

  const iAmBuyer = myId === ticket.buyerId;
  const iAmSeller = myId === ticket.sellerId;
  const myApproved = iAmBuyer
    ? ticket.buyerApprovedRevision === ticket.revision
    : iAmSeller
      ? ticket.sellerApprovedRevision === ticket.revision
      : false;
  const open = ticket.status === "PROPOSED" || ticket.status === "ACCEPTED";
  const canRespond = open && ticket.status === "PROPOSED" && !myApproved;
  const canPay =
    paymentsAccess &&
    iAmBuyer &&
    ticket.status === "ACCEPTED" &&
    Boolean(ticket.protectedTransactionId);

  const cur = ticket.currency;
  const rows = [
    [ticket.breakdown.labels.itemCost, ticket.itemCostMinor],
    [ticket.breakdown.labels.shipping, ticket.shippingMinor],
    [ticket.breakdown.labels.sellerServiceFee, ticket.sellerServiceFeeMinor],
    [
      ticket.breakdown.labels.sourceBridgeProtectionFee,
      ticket.protectionFeeMinor,
    ],
  ] as const;

  return (
    <div className="w-full rounded-xl border border-electric/35 bg-[#07152c] px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-electric" />
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-electric">
              Protected Payment
            </p>
            <p className="mt-0.5 text-sm font-medium text-white">
              {ticket.title || "Payment Ticket"} · v{ticket.revision}
            </p>
          </div>
        </div>
        <span className="rounded-md border border-white/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/55">
          {ticket.status}
        </span>
      </div>

      <p className="mt-2 text-xs text-white/45">
        Protected by Source Bridge ·{" "}
        {ticket.paymentOption === "INSTANT" || ticket.paymentOption === "DIRECT"
          ? "Direct Payment"
          : "Protected"}{" "}
        Transaction
        · funds held until delivery
      </p>

      <dl className="mt-4 space-y-1.5 text-sm">
        {rows.map(([label, amount]) =>
          amount > 0 || label.includes("Protection") ? (
            <div key={label} className="flex justify-between gap-3 text-white/75">
              <dt>{label}</dt>
              <dd className="tabular-nums text-white">{formatMinor(amount, cur)}</dd>
            </div>
          ) : null,
        )}
        <div className="flex justify-between gap-3 border-t border-white/10 pt-2 font-medium text-white">
          <dt>Total</dt>
          <dd className="tabular-nums">
            {formatMinor(ticket.totalChargeMinor, cur)}
          </dd>
        </div>
      </dl>

      {ticket.procurementAdvanceAgreed && ticket.procurementAdvanceMinor > 0 ? (
        <p className="mt-3 text-xs text-white/50">
          Procurement advance (Item Cost):{" "}
          {formatMinor(ticket.procurementAdvanceMinor, cur)} after funding when
          eligible.
        </p>
      ) : null}

      {ticket.status === "FUNDED" ? (
        <p className="mt-3 text-xs text-emerald-300/90">
          Funded and protected. Seller payout waits until delivery/release (not
          on fund).
        </p>
      ) : null}

      {error ? <p className="mt-3 text-xs text-amber-300">{error}</p> : null}
      {payNotice && !checkout ? (
        <p className="mt-3 text-xs text-electric">{payNotice}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {canRespond ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void respond("accept")}
              className="rounded-lg bg-electric px-3 py-1.5 text-xs font-medium text-app-navy hover:bg-electric-hover disabled:opacity-50"
            >
              Accept terms
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void respond("decline")}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/70 hover:border-white/40 disabled:opacity-50"
            >
              Decline
            </button>
          </>
        ) : null}
        {ticket.status === "PROPOSED" && myApproved ? (
          <p className="text-xs text-white/45">Waiting for the other party…</p>
        ) : null}
        {canPay && !checkout ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void startPay()}
            className="rounded-lg bg-electric px-3 py-1.5 text-xs font-medium text-app-navy hover:bg-electric-hover disabled:opacity-50"
          >
            Pay securely
          </button>
        ) : null}
      </div>

      {checkout ? (
        <ProtectedPaymentCheckout
          clientSecret={checkout.clientSecret}
          publishableKey={checkout.publishableKey}
          amountMinor={checkout.amountMinor}
          currency={checkout.currency}
          paymentMode={
            ticket.paymentOption === "INSTANT" || ticket.paymentOption === "DIRECT"
              ? "direct"
              : "protected"
          }
          protectedTxnId={ticket.protectedTransactionId || undefined}
          ordersHref="/profile/purchases"
          returnPath="/inbox?payment=return"
          onDismiss={() => setCheckout(null)}
          onPaymentSubmitted={() => {
            setPayNotice(
              "Payment received. Seller payout is being processed. Do not pay again.",
            );
            void load();
            onChanged?.();
          }}
        />
      ) : null}
    </div>
  );
}
