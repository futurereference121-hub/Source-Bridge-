/**
 * Buyer-present LIVE release still requires quote confirmation in the existing
 * review control. That is a Source Bridge app policy, not a Stripe requirement.
 * Stripe does not require a separate buyer confirmation of a replacement
 * OutboundPaymentQuote. After FX lock expiry, Stripe's published guidance is to
 * request another quote. LIVE still keeps this product gate. TEST skips it.
 * A missing mode keeps the confirmation gate.
 *
 * Inspection expiry and an authorized retry have no buyer session. They use a
 * recorded buyer action (Start Inspection, or the original release action on
 * retry) plus a valid matching unexpired quote. The worker is not written into
 * confirmedByUserId. A pre-submission replacement quote may be requested
 * without a second buyer confirmation; LIVE still requires the stored quote
 * that is later submitted to satisfy this app-policy gate.
 */
export function gpQuoteConfirmationRequired(
  stripeMode: string | null | undefined,
  payoutRail: string | null | undefined,
): boolean {
  if (payoutRail !== "STRIPE_GLOBAL_PAYOUTS") return false;
  return String(stripeMode || "").trim().toUpperCase() !== "TEST";
}

const QUOTE_REVIEW_CLOSED = new Set([
  "RELEASED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "CANCELLED",
  "FAILED",
]);

/**
 * Quote review is only offered with a server action that can still release.
 * Completed and other terminal purchases never show confirmation controls.
 */
export function purchaseQuoteReviewKind(order: {
  status?: string | null;
  stripeMode?: string | null;
  payoutRail?: string | null;
  actions?: {
    canReleaseProcurement?: boolean;
    canReleaseNow?: boolean;
  } | null;
}): "PROCUREMENT" | "FINAL" | null {
  if (!gpQuoteConfirmationRequired(order.stripeMode, order.payoutRail)) return null;
  const status = String(order.status || "");
  if (QUOTE_REVIEW_CLOSED.has(status)) return null;
  if (order.actions?.canReleaseProcurement) return "PROCUREMENT";
  if (status === "DELIVERED" && order.actions?.canReleaseNow) return "FINAL";
  if (status === "IN_INSPECTION" && order.actions?.canReleaseNow) return "FINAL";
  return null;
}
