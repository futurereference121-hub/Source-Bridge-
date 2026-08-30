/** User-facing checkout copy derived from authoritative Stripe runtime mode. */

export type CheckoutStripeMode = "TEST" | "LIVE";
export type CheckoutPayMode = "protected" | "direct";

export function resolveCheckoutStripeMode(
  stripeMode?: CheckoutStripeMode | null,
  publishableKey?: string,
): CheckoutStripeMode {
  if (stripeMode === "LIVE" || stripeMode === "TEST") return stripeMode;
  const key = String(publishableKey || "");
  if (key.startsWith("pk_live_")) return "LIVE";
  if (key.startsWith("pk_test_")) return "TEST";
  return "TEST";
}

export function checkoutSummaryCopy(
  stripeMode: CheckoutStripeMode,
  payMode: CheckoutPayMode,
): string {
  if (stripeMode === "LIVE") {
    return payMode === "direct"
      ? "Direct Payment. Real funds will be charged and released to the seller after Stripe confirms. No Source Bridge protection hold."
      : "Protected by Source Bridge. Real funds will be charged and held until the protected release conditions are met.";
  }
  return payMode === "direct"
    ? "Direct Payment (TEST). After Stripe confirms, funds are released to the seller. No Source Bridge inspection hold."
    : "Protected by Source Bridge (TEST). Payment is held until protected release rules are met.";
}

export function checkoutFormCopy(
  stripeMode: CheckoutStripeMode,
  payMode: CheckoutPayMode,
): string {
  if (stripeMode === "LIVE") {
    return payMode === "direct"
      ? "Direct Payment · Real funds will be charged and released to the seller after Stripe confirms (Destination Charges · no Source Bridge protection hold)."
      : "Protected by Source Bridge · Real funds will be charged and held until the protected release conditions are met.";
  }
  return payMode === "direct"
    ? "Direct Payment · TEST mode · Released to seller after Stripe confirms (Destination Charges · no Source Bridge protection hold)."
    : "Protected by Source Bridge · TEST mode · Funds stay protected until delivery (no seller transfer on payment).";
}

export function checkoutContinueLabel(
  stripeMode: CheckoutStripeMode,
  payMode: CheckoutPayMode,
  busy: boolean,
): string {
  if (busy) return "Starting checkout…";
  if (stripeMode === "LIVE") {
    return payMode === "direct"
      ? "Continue with Direct Payment"
      : "Continue with Protected Payment";
  }
  return payMode === "direct"
    ? "Continue with Direct Payment (TEST)"
    : "Continue with Protected Payment (TEST)";
}

export function checkoutPayButtonLabel(stripeMode: CheckoutStripeMode): string {
  return stripeMode === "LIVE" ? "Pay securely" : "Pay securely (TEST)";
}

export function checkoutStartedToast(
  stripeMode: CheckoutStripeMode,
  payMode: CheckoutPayMode,
): string {
  if (stripeMode === "LIVE") {
    return payMode === "direct"
      ? "Enter card details for Direct Payment"
      : "Enter your card details to fund the Protected Payment";
  }
  return payMode === "direct"
    ? "Enter card details for Direct Payment (TEST)"
    : "Enter your card details to fund the Protected Payment (TEST)";
}
