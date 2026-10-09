/**
 * Buyer-present LIVE release still requires quote confirmation in the existing
 * review control. That policy is unchanged: the current actor must be the buyer
 * who confirmed the stored quote.
 *
 * Inspection expiry and an authorized retry have no buyer session. They use a
 * recorded buyer action (Start Inspection, or the original release action on
 * retry) plus a valid matching unexpired quote. The worker is not written into
 * confirmedByUserId. Refreshing an expired quote before submission is a
 * separate correction; Stripe has not disclosed that a background worker may
 * submit that replacement without another buyer confirmation.
 *
 * TEST uses the buyer's existing release action, or a recorded inspection window.
 * A missing mode keeps the confirmation gate. No extra approval screen.
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
