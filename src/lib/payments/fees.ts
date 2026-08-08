import {
  assertNonNegativeInt,
  totalChargeMinor,
  type MoneyBreakdownInput,
} from "@/lib/payments/money";
import {
  isDirectPaymentOption,
  platformFeePublicLabel,
} from "@/lib/payments/payment-option";

export type FeeConfig = {
  protectionFeeBps: number;
  protectionFeeFloorMinor: number;
  sellerServiceFeeBps: number;
  /** Direct Payment platform service fee (basis points of item+shipping). */
  directServiceFeeBps: number;
  directServiceFeeFloorMinor: number;
};

export type FeeLineItems = MoneyBreakdownInput & {
  /** Public label depends on payment option. */
  platformFeeLabel:
    | "Source Bridge Protection Fee"
    | "Source Bridge service fee";
  protectionFeeLabel:
    | "Source Bridge Protection Fee"
    | "Source Bridge service fee";
  sellerServiceFeeLabel: "Seller Service Fee";
  feeKind: "PROTECTION" | "SERVICE";
};

/**
 * Server-side fee calculation. Client may propose item/shipping only;
 * platform + seller service fees are always recalculated here.
 *
 * Protected → Protection Fee (protectionFeeBps / floor).
 * Direct (INSTANT/DIRECT) → Source Bridge service fee (directServiceFeeBps / floor).
 * Platform fee is stored in protectionFeeMinor for both paths (existing ledger field).
 */
export function calculateFees(opts: {
  itemCostMinor: number;
  shippingMinor: number;
  config: FeeConfig;
  /** PROTECTED | INSTANT | DIRECT — defaults PROTECTED. */
  paymentOption?: string;
  /** Optional override when seller and buyer agreed a fixed seller service fee. */
  sellerServiceFeeMinorOverride?: number;
}): FeeLineItems {
  const itemCostMinor = assertNonNegativeInt(opts.itemCostMinor, "itemCostMinor");
  const shippingMinor = assertNonNegativeInt(opts.shippingMinor, "shippingMinor");
  const base = itemCostMinor + shippingMinor;
  const direct = isDirectPaymentOption(opts.paymentOption);

  const feeBps = direct
    ? opts.config.directServiceFeeBps
    : opts.config.protectionFeeBps;
  const feeFloor = direct
    ? opts.config.directServiceFeeFloorMinor
    : opts.config.protectionFeeFloorMinor;

  const platformRaw = Math.ceil((base * Math.max(0, feeBps)) / 10_000);
  const protectionFeeMinor = Math.max(
    platformRaw,
    base > 0 ? Math.max(0, feeFloor) : 0,
  );

  let sellerServiceFeeMinor: number;
  if (opts.sellerServiceFeeMinorOverride !== undefined) {
    sellerServiceFeeMinor = assertNonNegativeInt(
      opts.sellerServiceFeeMinorOverride,
      "sellerServiceFeeMinor",
    );
  } else {
    sellerServiceFeeMinor = Math.ceil(
      (base * Math.max(0, opts.config.sellerServiceFeeBps)) / 10_000,
    );
  }

  const platformFeeLabel = platformFeePublicLabel(
    direct ? "INSTANT" : "PROTECTED",
  );

  return {
    itemCostMinor,
    shippingMinor,
    sellerServiceFeeMinor,
    protectionFeeMinor,
    platformFeeLabel,
    protectionFeeLabel: platformFeeLabel,
    sellerServiceFeeLabel: "Seller Service Fee",
    feeKind: direct ? "SERVICE" : "PROTECTION",
  };
}

export function assertTotalsMatch(
  breakdown: MoneyBreakdownInput,
  claimedTotal: number,
): void {
  const expected = totalChargeMinor(breakdown);
  if (expected !== claimedTotal) {
    throw Object.assign(
      new Error(
        `Total mismatch: expected ${expected} minor units, got ${claimedTotal}`,
      ),
      { status: 400, code: "TOTAL_MISMATCH" },
    );
  }
}

/** Amount eligible for procurement advance = Item Cost only (not shipping/fees). */
export function procurementAdvanceAmount(opts: {
  agreed: boolean;
  itemCostMinor: number;
  eligible: boolean;
}): number {
  if (!opts.agreed || !opts.eligible) return 0;
  return assertNonNegativeInt(opts.itemCostMinor, "itemCostMinor");
}

/** Remainder held until delivery/inspection release. */
export function protectedRemainderMinor(
  breakdown: MoneyBreakdownInput,
  procurementMinor: number,
): number {
  const total = totalChargeMinor(breakdown);
  const proc = assertNonNegativeInt(procurementMinor, "procurementMinor");
  // Platform keeps protection/service fee; seller receives item+shipping+sellerService - procurement already sent
  const sellerShare =
    breakdown.itemCostMinor +
    breakdown.shippingMinor +
    breakdown.sellerServiceFeeMinor;
  return Math.max(0, sellerShare - proc) + (total - sellerShare);
}
