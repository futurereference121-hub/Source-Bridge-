/**
 * Shared financial breakdown for Protected / procurement flows.
 * Single source of truth for UI, API, refunds, and release math.
 */

import { assertNonNegativeInt, totalChargeMinor } from "@/lib/payments/money";

export type ProtectedFinancialInput = {
  itemCostMinor: number;
  shippingMinor: number;
  sellerServiceFeeMinor: number;
  protectionFeeMinor: number;
  totalChargeMinor?: number;
  procurementAdvanceAgreed?: boolean;
  procurementAdvanceMinor?: number;
  procurementTransferredMinor?: number;
  finalTransferredMinor?: number;
  refundedMinor?: number;
  /** Quoted item/shipping already include the platform fee — seller net is reduced. */
  platformFeeIncludedInPrice?: boolean;
};

export type ProtectedFinancialBreakdown = {
  currencySafe: true;
  /** Total charged on the PaymentIntent (gross funded when status ≥ FUNDED). */
  grossFundedMinor: number;
  itemCostMinor: number;
  shippingMinor: number;
  sellerServiceFeeMinor: number;
  /** Platform Protection / service fee (stored as protectionFeeMinor). */
  platformFeeMinor: number;
  /** Seller entitled amount = item + shipping + seller service (not platform fee). */
  sellerEntitledMinor: number;
  procurementAdvanceAgreed: boolean;
  /** Cap on early item-cost release (item cost only — never shipping). */
  procurementAdvanceMinor: number;
  procurementTransferredMinor: number;
  finalTransferredMinor: number;
  refundedMinor: number;
  transferredTotalMinor: number;
  /**
   * Amount still held on the platform charge (cannot exceed charge minus
   * transfers and refunds).
   */
  protectedRemainingMinor: number;
  /** Safe to refund via Stripe (no reverse of seller transfers). */
  refundableMinor: number;
  /**
   * Residual seller share still to release at final (after residual-only rules).
   */
  finalResidualMinor: number;
  /**
   * Seller share remaining protected after early item release (shipping +
   * seller service + unreleased item remainder).
   */
  remainingProtectedSellerShareMinor: number;
  /** Pre-accept / funded copy for release structure (procurementAdvanceMinor). */
  itemFundsReleasedEarlyMinor: number;
  labels: {
    itemCost: string;
    shipping: string;
    sellerServiceFee: string;
    platformFee: string;
    itemFundsReleasedEarly: string;
    remainingProtected: string;
  };
};

export function computeProtectedFinancials(
  input: ProtectedFinancialInput,
): ProtectedFinancialBreakdown {
  const itemCostMinor = assertNonNegativeInt(input.itemCostMinor, "itemCostMinor");
  const shippingMinor = assertNonNegativeInt(input.shippingMinor, "shippingMinor");
  const sellerServiceFeeMinor = assertNonNegativeInt(
    input.sellerServiceFeeMinor,
    "sellerServiceFeeMinor",
  );
  const platformFeeMinor = assertNonNegativeInt(
    input.protectionFeeMinor,
    "protectionFeeMinor",
  );
  const expectedTotal = totalChargeMinor({
    itemCostMinor,
    shippingMinor,
    sellerServiceFeeMinor,
    protectionFeeMinor: platformFeeMinor,
  });
  const grossFundedMinor =
    input.totalChargeMinor !== undefined
      ? assertNonNegativeInt(input.totalChargeMinor, "totalChargeMinor")
      : expectedTotal;

  const sellerEntitledMinor = Math.max(
    0,
    itemCostMinor +
      shippingMinor +
      sellerServiceFeeMinor -
      (input.platformFeeIncludedInPrice ? platformFeeMinor : 0),
  );

  const procurementAdvanceAgreed = Boolean(input.procurementAdvanceAgreed);
  const procurementAdvanceMinor = Math.min(
    assertNonNegativeInt(
      input.procurementAdvanceMinor ?? 0,
      "procurementAdvanceMinor",
    ),
    // Hard cap: item cost only (never shipping / fees).
    itemCostMinor,
  );
  const procurementTransferredMinor = assertNonNegativeInt(
    input.procurementTransferredMinor ?? 0,
    "procurementTransferredMinor",
  );
  const finalTransferredMinor = assertNonNegativeInt(
    input.finalTransferredMinor ?? 0,
    "finalTransferredMinor",
  );
  const refundedMinor = assertNonNegativeInt(
    input.refundedMinor ?? 0,
    "refundedMinor",
  );

  const transferredTotalMinor =
    procurementTransferredMinor + finalTransferredMinor;

  const protectedRemainingMinor = Math.max(
    0,
    grossFundedMinor - transferredTotalMinor - refundedMinor,
  );

  // Never reverse seller transfers silently — only platform remainder is refundable.
  const refundableMinor = protectedRemainingMinor;

  /**
   * Residual seller share still releasable via releaseFinal.
   * Cap by platform cash left after refunds, reserving remaining platform fee
   * so fee is never paid out as “seller residual”.
   */
  const sellerShareOutstanding = Math.max(
    0,
    sellerEntitledMinor - transferredTotalMinor,
  );
  const feeStillOnPlatform = Math.min(platformFeeMinor, protectedRemainingMinor);
  const platformSellerCash = Math.max(
    0,
    protectedRemainingMinor - feeStillOnPlatform,
  );
  const finalResidualMinor = Math.min(
    sellerShareOutstanding,
    platformSellerCash,
  );

  const remainingProtectedSellerShareMinor = Math.max(
    0,
    sellerEntitledMinor - procurementAdvanceMinor,
  );

  return {
    currencySafe: true,
    grossFundedMinor,
    itemCostMinor,
    shippingMinor,
    sellerServiceFeeMinor,
    platformFeeMinor,
    sellerEntitledMinor,
    procurementAdvanceAgreed,
    procurementAdvanceMinor,
    procurementTransferredMinor,
    finalTransferredMinor,
    refundedMinor,
    transferredTotalMinor,
    protectedRemainingMinor,
    refundableMinor,
    finalResidualMinor,
    remainingProtectedSellerShareMinor,
    itemFundsReleasedEarlyMinor: procurementAdvanceAgreed
      ? procurementAdvanceMinor
      : 0,
    labels: {
      itemCost: "Item / procurement budget",
      shipping: "Shipping",
      sellerServiceFee: "Sourcer fee",
      platformFee: "Source Bridge fee",
      itemFundsReleasedEarly: "Item funds released early",
      remainingProtected: "Remaining protected",
    },
  };
}

/** Assert release invariants before money movement. */
export function assertProcurementReleaseInvariants(opts: {
  sellerEntitledMinor: number;
  procurementAdvanceMinor: number;
  procurementTransferredMinor: number;
  finalTransferredMinor: number;
  nextProcurementDelta: number;
}): void {
  const delta = assertNonNegativeInt(
    opts.nextProcurementDelta,
    "nextProcurementDelta",
  );
  const nextProc = opts.procurementTransferredMinor + delta;
  if (nextProc > opts.procurementAdvanceMinor) {
    throw Object.assign(
      new Error("Procurement transfer would exceed agreed advance (item cost)"),
      { status: 409, code: "PROCUREMENT_EXCEEDS_ADVANCE" },
    );
  }
  if (
    nextProc + opts.finalTransferredMinor > opts.sellerEntitledMinor
  ) {
    throw Object.assign(
      new Error("Procurement transfer would exceed seller entitled amount"),
      { status: 409, code: "PROCUREMENT_EXCEEDS_SELLER_SHARE" },
    );
  }
}

export function assertFinalReleaseInvariants(opts: {
  sellerEntitledMinor: number;
  procurementTransferredMinor: number;
  finalTransferredMinor: number;
  nextFinalDelta: number;
}): void {
  const delta = assertNonNegativeInt(opts.nextFinalDelta, "nextFinalDelta");
  const nextFinal = opts.finalTransferredMinor + delta;
  if (
    opts.procurementTransferredMinor + nextFinal > opts.sellerEntitledMinor
  ) {
    throw Object.assign(
      new Error("Final transfer would exceed seller entitled amount"),
      { status: 409, code: "FINAL_EXCEEDS_SELLER_SHARE" },
    );
  }
  // Residual-only: proposed amount must match seller residual.
  const residual = Math.max(
    0,
    opts.sellerEntitledMinor -
      opts.procurementTransferredMinor -
      opts.finalTransferredMinor,
  );
  if (delta > residual) {
    throw Object.assign(
      new Error("Final release must be residual seller share only"),
      { status: 409, code: "FINAL_NOT_RESIDUAL" },
    );
  }
}
