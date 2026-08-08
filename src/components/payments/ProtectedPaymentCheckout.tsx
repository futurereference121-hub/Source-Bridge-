"use client";

/**
 * Browser success alone never marks FUNDED - funding is webhook-only.
 * After confirmPayment succeeds we poll SB txn status and never infinite-spin.
 */

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Loader2 } from "lucide-react";
import { formatMinor } from "@/lib/payments/money";

type PaymentUiPhase =
  | "ready"
  | "confirming"
  | "polling"
  | "complete"
  | "received_pending"
  | "error";

type CheckoutInnerProps = {
  amountMinor: number;
  currency: string;
  returnPath: string;
  onDismiss: () => void;
  onSubmitted: () => void;
  paymentMode?: "protected" | "direct";
  protectedTxnId?: string;
  ordersHref?: string;
};

const POLL_MS = 2000;
const POLL_MAX = 12;

async function fetchTxnStatus(protectedTxnId: string): Promise<{
  paymentReceived: boolean;
  payoutSettled: boolean;
  status: string;
} | null> {
  try {
    const res = await fetch(
      `/api/payments/checkout?protectedTxnId=${encodeURIComponent(protectedTxnId)}`,
      { credentials: "include" },
    );
    const json = (await res.json().catch(() => ({}))) as {
      transaction?: {
        paymentReceived?: boolean;
        payoutSettled?: boolean;
        status?: string;
      };
    };
    if (!res.ok || !json.transaction) return null;
    return {
      paymentReceived: Boolean(json.transaction.paymentReceived),
      payoutSettled: Boolean(json.transaction.payoutSettled),
      status: String(json.transaction.status || ""),
    };
  } catch {
    return null;
  }
}

function CheckoutForm({
  amountMinor,
  currency,
  returnPath,
  onDismiss,
  onSubmitted,
  paymentMode = "protected",
  protectedTxnId,
  ordersHref = "/profile/purchases",
}: CheckoutInnerProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [phase, setPhase] = useState<PaymentUiPhase>("ready");
  const [error, setError] = useState("");

  useEffect(() => {
    if (phase !== "polling" || !protectedTxnId) return;
    let cancelled = false;
    let n = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      if (cancelled) return;
      n += 1;
      const st = await fetchTxnStatus(protectedTxnId!);
      if (cancelled) return;
      if (st?.payoutSettled || (st?.paymentReceived && paymentMode === "protected")) {
        setPhase("complete");
        return;
      }
      if (st?.paymentReceived && paymentMode === "direct") {
        // Funded / routed — treat as success even if booking still catching RELEASED.
        setPhase("complete");
        return;
      }
      if (n >= POLL_MAX) {
        // Never infinite spinner; never tell buyer to pay again.
        setPhase("received_pending");
        return;
      }
      timer = setTimeout(() => void tick(), POLL_MS);
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [phase, protectedTxnId, paymentMode]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    if (phase !== "ready" && phase !== "error") return;
    setPhase("confirming");
    setError("");
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const returnUrl = `${origin}${returnPath}`;
      const { error: confirmError } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: returnUrl,
        },
        redirect: "if_required",
      });
      if (confirmError) {
        setError(confirmError.message || "Payment failed");
        setPhase("error");
        return;
      }
      // Card path may succeed without redirect. Do NOT claim FUNDED; poll SB.
      onSubmitted();
      if (protectedTxnId) {
        setPhase("polling");
      } else {
        setPhase("received_pending");
      }
    } catch {
      setError("Payment failed");
      setPhase("error");
    }
  }

  const busy = phase === "confirming" || phase === "polling";
  const finished = phase === "complete" || phase === "received_pending";

  if (finished) {
    return (
      <div className="space-y-3">
        {phase === "complete" ? (
          <p className="text-sm text-white/80">
            {paymentMode === "direct"
              ? "Payment received. Direct Payment is complete — funds route to the seller via Stripe (no Source Bridge hold)."
              : "Payment received. Your Protected Payment is funded. Funds stay protected until delivery rules are met."}
          </p>
        ) : (
          <p className="text-sm text-white/80">
            Payment received. Seller payout is being processed. Do not pay again.
          </p>
        )}
        <p className="text-[11px] text-white/40">
          Status updates when Stripe webhooks confirm. You will not be charged
          twice for this order.
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href={ordersHref}
            className="inline-flex items-center rounded-lg bg-electric px-3 py-1.5 text-xs font-medium text-app-navy hover:bg-electric-hover"
          >
            View orders
          </a>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/70"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-white/70">
        Total due:{" "}
        <span className="font-medium text-white">
          {formatMinor(amountMinor, currency)}
        </span>
      </p>
      <p className="text-[11px] text-white/40">
        {paymentMode === "direct"
          ? "Direct Payment · TEST mode · Released to seller after Stripe confirms (Destination Charges · no Source Bridge protection hold)."
          : "Protected by Source Bridge · TEST mode · Funds stay protected until delivery (no seller transfer on payment)."}
      </p>
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
        <PaymentElement
          options={{
            layout: "tabs",
          }}
        />
      </div>
      {error ? <p className="text-xs text-amber-300">{error}</p> : null}
      {phase === "polling" ? (
        <p className="flex items-center gap-1.5 text-xs text-white/55">
          <Loader2 size={14} className="animate-spin" /> Confirming with Source
          Bridge…
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={!stripe || !elements || busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-electric px-3 py-1.5 text-xs font-medium text-app-navy hover:bg-electric-hover disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          {phase === "confirming"
            ? "Processing…"
            : phase === "polling"
              ? "Confirming…"
              : "Pay securely (TEST)"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDismiss}
          className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/70"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export type ProtectedPaymentCheckoutProps = {
  clientSecret: string;
  publishableKey: string;
  amountMinor: number;
  currency: string;
  /** Where Stripe may redirect after 3DS — must not be treated as FUNDED. */
  returnPath?: string;
  paymentMode?: "protected" | "direct";
  /** SB protected transaction id — used to poll after confirmPayment (no re-pay). */
  protectedTxnId?: string;
  ordersHref?: string;
  onDismiss: () => void;
  onPaymentSubmitted: () => void;
};

export function ProtectedPaymentCheckout({
  clientSecret,
  publishableKey,
  amountMinor,
  currency,
  returnPath = "/inbox?payment=return",
  paymentMode = "protected",
  protectedTxnId,
  ordersHref,
  onDismiss,
  onPaymentSubmitted,
}: ProtectedPaymentCheckoutProps) {
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(
    null,
  );

  useEffect(() => {
    if (!publishableKey || !publishableKey.startsWith("pk_test_")) {
      setStripePromise(null);
      return;
    }
    setStripePromise(loadStripe(publishableKey));
  }, [publishableKey]);

  const options = useMemo(
    () => ({
      clientSecret,
      appearance: {
        theme: "night" as const,
        variables: {
          colorPrimary: "#3d9eff",
          colorBackground: "#07152c",
          colorText: "#ffffff",
          borderRadius: "8px",
        },
      },
    }),
    [clientSecret],
  );

  if (!publishableKey.startsWith("pk_test_")) {
    return (
      <p className="text-xs text-amber-300">
        Stripe TEST publishable key required (pk_test_…).
      </p>
    );
  }

  if (!stripePromise) {
    return (
      <div className="flex items-center gap-2 text-xs text-white/50">
        <Loader2 size={14} className="animate-spin" /> Loading payment form…
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-electric/30 bg-[#050f20] p-3">
      <Elements stripe={stripePromise} options={options}>
        <CheckoutForm
          amountMinor={amountMinor}
          currency={currency}
          returnPath={returnPath}
          paymentMode={paymentMode}
          protectedTxnId={protectedTxnId}
          ordersHref={ordersHref}
          onDismiss={onDismiss}
          onSubmitted={onPaymentSubmitted}
        />
      </Elements>
    </div>
  );
}
