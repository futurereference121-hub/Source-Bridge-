/**
 * Transaction payment option helpers.
 *
 * Product name: "Direct Payment" (UI only).
 * Storage/canonical money-flow value remains INSTANT (legacy) — DIRECT is accepted as an alias.
 *
 * PROTECTED: Separate Charges and Transfers — never transfers on fund.
 * DIRECT: Destination Charges (transfer_data.destination + application_fee) — never
 * transfers.create on fund; Stripe routes seller share at charge success.
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

/** Platform fee line label on checkout / receipts (rate for NEW calcs; history uses stored minor). */
export function platformFeePublicLabel(
  option: string | null | undefined,
):
  | "Source Bridge Protection Fee (2%)"
  | "Source Bridge service fee (2%)" {
  return isDirectPaymentOption(option)
    ? "Source Bridge service fee (2%)"
    : "Source Bridge Protection Fee (2%)";
}
