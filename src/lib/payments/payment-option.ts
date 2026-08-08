/**
 * Transaction payment option helpers.
 *
 * Product name: "Direct Payment" (UI only).
 * Storage/canonical money-flow value remains INSTANT (legacy) — DIRECT is accepted as an alias.
 * PROTECTED never transfers on fund.
 */

export const TXN_PAYMENT_OPTIONS = ["PROTECTED", "INSTANT", "DIRECT"] as const;
export type TxnPaymentOptionInput = (typeof TXN_PAYMENT_OPTIONS)[number];

/** Canonical stored values used by release/fund paths. */
export type CanonicalTxnPaymentOption = "PROTECTED" | "INSTANT";

/** True when payment is released after Stripe confirms (no inspection hold). */
export function isDirectPaymentOption(
  option: string | null | undefined,
): boolean {
  const v = (option || "").toUpperCase();
  return v === "INSTANT" || v === "DIRECT";
}

export function isProtectedPaymentOption(
  option: string | null | undefined,
): boolean {
  return !isDirectPaymentOption(option);
}

/**
 * Normalize API / client values to storage form.
 * DIRECT and INSTANT both store as INSTANT so releaseFinal + webhooks stay compatible.
 */
export function normalizeTxnPaymentOption(
  raw: string | null | undefined,
): CanonicalTxnPaymentOption {
  if (isDirectPaymentOption(raw)) return "INSTANT";
  return "PROTECTED";
}

/** Public UI label (never "Instant"). */
export function paymentOptionPublicLabel(
  option: string | null | undefined,
): "Protected Payment" | "Direct Payment" {
  return isDirectPaymentOption(option)
    ? "Direct Payment"
    : "Protected Payment";
}

/** Platform fee line label on checkout / receipts. */
export function platformFeePublicLabel(
  option: string | null | undefined,
): "Source Bridge Protection Fee" | "Source Bridge service fee" {
  return isDirectPaymentOption(option)
    ? "Source Bridge service fee"
    : "Source Bridge Protection Fee";
}
