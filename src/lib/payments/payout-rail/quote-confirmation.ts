/**
 * LIVE Global Payouts still requires the buyer to confirm a quote before release.
 * TEST uses the buyer's existing release action, or a recorded inspection window.
 * A missing mode keeps the confirmation gate.
 */
export function gpQuoteConfirmationRequired(
  stripeMode: string | null | undefined,
  payoutRail: string | null | undefined,
): boolean {
  if (payoutRail !== "STRIPE_GLOBAL_PAYOUTS") return false;
  return String(stripeMode || "").trim().toUpperCase() !== "TEST";
}
