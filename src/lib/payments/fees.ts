import {
  assertNonNegativeInt,
  totalChargeMinor,
  type MoneyBreakdownInput,
} from "@/lib/payments/money";

export type FeeConfig = {
  protectionFeeBps: number;
  protectionFeeFloorMinor: number;
  sellerServiceFeeBps: number;
};

export type FeeLineItems = MoneyBreakdownInput & {
  /** Public label: Source Bridge Protection Fee */
  protectionFeeLabel: "Source Bridge Protection Fee";
  sellerServiceFeeLabel: "Seller Service Fee";
};

/**
 * Server-side fee calculation. Client may propose item/shipping only;
 * protection + seller service fees are always recalculated here.
 */
export function calculateFees(opts: {
  itemCostMinor: number;
  shippingMinor: number;
  config: FeeConfig;
  /** Optional override when seller and buyer agreed a fixed seller service fee. */
  sellerServiceFeeMinorOverride?: number;
}): FeeLineItems {
  const itemCostMinor = assertNonNegativeInt(opts.itemCostMinor, "itemCostMinor");
  const shippingMinor = assertNonNegativeInt(opts.shippingMinor, "shippingMinor");
  const base = itemCostMinor + shippingMinor;

  const protectionRaw = Math.ceil(
    (base * Math.max(0, opts.config.protectionFeeBps)) / 10_000,
  );
  const protectionFeeMinor = Math.max(
    protectionRaw,
    base > 0 ? Math.max(0, opts.config.protectionFeeFloorMinor) : 0,
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

  return {
    itemCostMinor,
    shippingMinor,
    sellerServiceFeeMinor,
    protectionFeeMinor,
    protectionFeeLabel: "Source Bridge Protection Fee",
    sellerServiceFeeLabel: "Seller Service Fee",
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
export function protectedRemainderMinor(breakdown: MoneyBreakdownInput, procurementMinor: number): number {
  const total = totalChargeMinor(breakdown);
  const proc = assertNonNegativeInt(procurementMinor, "procurementMinor");
  // Platform keeps protection fee; seller receives item+shipping+sellerService - procurement already sent
  const sellerShare =
    breakdown.itemCostMinor +
    breakdown.shippingMinor +
    breakdown.sellerServiceFeeMinor;
  return Math.max(0, sellerShare - proc) + (total - sellerShare);
}
