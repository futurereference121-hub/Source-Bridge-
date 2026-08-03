import { createHash } from "crypto";
import { normalizeCurrency, totalChargeMinor } from "@/lib/payments/money";

export type CanonicalTerms = {
  currency: string;
  itemCostMinor: number;
  shippingMinor: number;
  sellerServiceFeeMinor: number;
  protectionFeeMinor: number;
  totalChargeMinor: number;
  paymentOption: "PROTECTED" | "INSTANT";
  procurementAdvanceAgreed: boolean;
  procurementAdvanceMinor: number;
  title: string;
  listingId: string | null;
  buyerId: string;
  sellerId: string;
  revision: number;
};

/** Stable JSON for hashing — sorted keys, no whitespace variance. */
export function canonicalizeTerms(terms: CanonicalTerms): string {
  const ordered: CanonicalTerms = {
    buyerId: terms.buyerId,
    currency: normalizeCurrency(terms.currency),
    itemCostMinor: terms.itemCostMinor,
    listingId: terms.listingId,
    paymentOption: terms.paymentOption,
    procurementAdvanceAgreed: terms.procurementAdvanceAgreed,
    procurementAdvanceMinor: terms.procurementAdvanceMinor,
    protectionFeeMinor: terms.protectionFeeMinor,
    revision: terms.revision,
    sellerId: terms.sellerId,
    sellerServiceFeeMinor: terms.sellerServiceFeeMinor,
    shippingMinor: terms.shippingMinor,
    title: terms.title.trim(),
    totalChargeMinor: terms.totalChargeMinor,
  };
  const expected = totalChargeMinor(ordered);
  if (expected !== ordered.totalChargeMinor) {
    throw Object.assign(new Error("terms totalChargeMinor mismatch"), {
      status: 400,
      code: "TOTAL_MISMATCH",
    });
  }
  return JSON.stringify(ordered);
}

export function hashTerms(terms: CanonicalTerms): string {
  return createHash("sha256").update(canonicalizeTerms(terms)).digest("hex");
}
