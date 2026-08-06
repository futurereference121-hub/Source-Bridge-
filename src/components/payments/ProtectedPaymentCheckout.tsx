"use client";

/**
 * Stripe Payment Element for Protected Payment TEST checkout.
 * Browser success alone never marks FUNDED — funding is webhook-only.
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

type CheckoutInnerProps = {
  amountMinor: number;
  currency: string;
  returnPath: string;
  onDismiss: () => void;
  onSubmitted: () => void;
};

function CheckoutForm({
  amountMinor,
  currency,
  returnPath,
  onDismiss,
  onSubmitted,
}: CheckoutInnerProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
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
        setBusy(false);
        return;
      }
      // Payment may succeed without redirect (cards). Do NOT claim FUNDED here.
      onSubmitted();
    } catch {
      setError("Payment failed");
      setBusy(false);
    }
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
        Protected by Source Bridge · TEST mode · Funds stay protected until
        delivery (no seller transfer on payment).
      </p>
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
        <PaymentElement
          options={{
            layout: "tabs",
          }}
        />
      </div>
      {error ? <p className="text-xs text-amber-300">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={!stripe || !elements || busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-electric px-3 py-1.5 text-xs font-medium text-app-navy hover:bg-electric-hover disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          Pay securely (TEST)
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
  onDismiss: () => void;
  onPaymentSubmitted: () => void;
};

export function ProtectedPaymentCheckout({
  clientSecret,
  publishableKey,
  amountMinor,
  currency,
  returnPath = "/inbox?payment=return",
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
          onDismiss={onDismiss}
          onSubmitted={onPaymentSubmitted}
        />
      </Elements>
    </div>
  );
}
