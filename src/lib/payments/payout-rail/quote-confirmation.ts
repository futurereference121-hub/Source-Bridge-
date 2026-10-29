/**
 * Global Payouts follows Connect’s buyer-authorized sourcing-ticket workflow.
 * Buyer pay, Release Item Funds, final/inspection/admin authorization are the
 * payment gates. After that authorization, quotes are created or refreshed
 * automatically inside the accepted agreement. There is no additional buyer
 * quote-confirmation click.
 *
 * Stripe does not require a separate buyer confirmation of an
 * OutboundPaymentQuote. After FX lock expiry, Stripe's published guidance is
 * to request another quote. Source Bridge now matches that: replacement quotes
 * stay inside the recorded authorization and must not change seller entitlement
 * or the accepted buyer total.
 */
export function gpQuoteConfirmationRequired(
  stripeMode: string | null | undefined,
  payoutRail: string | null | undefined,
): boolean {
  void stripeMode;
  void payoutRail;
  return false;
}

const QUOTE_REVIEW_CLOSED = new Set([
  "RELEASED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "CANCELLED",
  "FAILED",
]);

/**
 * Quote-review controls are retired. Authorized GP execution creates and
 * refreshes quotes automatically. This stays so completed purchases never
 * grow a confirmation UI if a caller still asks.
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
