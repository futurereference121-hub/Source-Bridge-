/**
 * Pure shapers for a read-only TEST Connect reserve reconciliation.
 * Does not call Stripe or write payment records.
 */

import { allocateGpProceedsFunding, type AllocateFundingInput } from "./proceeds-funding";

export type StripeMovementEvidence = {
  chargeLivemode?: boolean;
  chargeCurrency?: string;
  chargeAmountMinor?: number;
  balanceTransactionCurrency?: string;
  balanceTransactionGrossMinor?: number;
  balanceTransactionNetMinor?: number;
  balanceTransactionStatus?: string;
  refundedMinor?: number;
  /** Settlement-currency transfer debits still attributed to this charge. */
  transferSettleMinor?: number;
  reversedTransferSettleMinor?: number;
  transferCount?: number;
  failureCode?: string | null;
};

export type BooksObligation = {
  purchaseHash: string;
  purchaseCurrency: string;
  status: string;
  paymentOption: string;
  disputed: boolean;
  sellerEntitlementMinor: number;
  transferredMinor: number;
  connectRemainderMinor: number;
  refundReserveMinor: number;
  booksReserveMinor: number;
  settlementCurrency: string | null;
  chargeAmountMinor: number | null;
  balanceTransactionAmountMinor: number | null;
};

/**
 * Estimate what the charge's own Stripe residual still implies on the platform.
 * Net settled minus seller transfers (net of reversals) minus refunds.
 * Null when any required figure is missing. This is not current balance availability.
 */
export function stripeImpliedPlatformHoldMinor(evidence: StripeMovementEvidence): number | null {
  if (evidence.failureCode) return null;
  if (evidence.chargeLivemode === true) return null;
  const net = evidence.balanceTransactionNetMinor;
  const refunded = evidence.refundedMinor;
  const transferred = evidence.transferSettleMinor;
  const reversed = evidence.reversedTransferSettleMinor ?? 0;
  if (
    typeof net !== "number" ||
    !Number.isInteger(net) ||
    typeof refunded !== "number" ||
    !Number.isInteger(refunded) ||
    typeof transferred !== "number" ||
    !Number.isInteger(transferred) ||
    !Number.isInteger(reversed)
  ) {
    return null;
  }
  return net - Math.max(0, transferred - reversed) - refunded;
}

export function classifyConnectReserveGap(input: {
  books: BooksObligation;
  stripe: StripeMovementEvidence;
}): {
  code: string;
  booksReserveMinor: number;
  stripeImpliedHoldMinor: number | null;
  gapBooksMinusStripeHold: number | null;
  confirmed: string[];
  unresolved: string[];
} {
  const booksReserveMinor = input.books.booksReserveMinor;
  const confirmed: string[] = [];
  const unresolved: string[] = [];
  if (input.books.disputed) confirmed.push("open_or_status_dispute_hold");
  if (input.books.connectRemainderMinor > 0) confirmed.push("untransferred_seller_remainder");
  if (input.books.refundReserveMinor > 0) confirmed.push("dispute_fee_or_refund_hold");

  if (input.stripe.failureCode) {
    unresolved.push(`stripe_read:${input.stripe.failureCode}`);
    return {
      code: "STRIPE_READ_FAILED",
      booksReserveMinor,
      stripeImpliedHoldMinor: null,
      gapBooksMinusStripeHold: null,
      confirmed,
      unresolved,
    };
  }
  if (input.stripe.chargeLivemode === true) {
    unresolved.push("charge_livemode_true");
    return {
      code: "STRIPE_MODE_MISMATCH",
      booksReserveMinor,
      stripeImpliedHoldMinor: null,
      gapBooksMinusStripeHold: null,
      confirmed,
      unresolved,
    };
  }

  const hold = stripeImpliedPlatformHoldMinor(input.stripe);
  if (hold == null) {
    unresolved.push("stripe_hold_uncomputable");
    return {
      code: "STRIPE_HOLD_UNRESOLVED",
      booksReserveMinor,
      stripeImpliedHoldMinor: null,
      gapBooksMinusStripeHold: null,
      confirmed,
      unresolved,
    };
  }

  const gap = booksReserveMinor - hold;
  if (hold <= 0 && booksReserveMinor > 0) {
    confirmed.push("stripe_charge_residual_non_positive");
    unresolved.push("books_still_reserve_after_charge_residual_gone");
    return {
      code: "BOOKS_RESERVE_WITHOUT_CHARGE_RESIDUAL",
      booksReserveMinor,
      stripeImpliedHoldMinor: hold,
      gapBooksMinusStripeHold: gap,
      confirmed,
      unresolved,
    };
  }
  if (Math.abs(gap) <= 1) {
    confirmed.push("books_reserve_matches_charge_residual");
    return {
      code: "BOOKS_MATCH_CHARGE_RESIDUAL",
      booksReserveMinor,
      stripeImpliedHoldMinor: hold,
      gapBooksMinusStripeHold: gap,
      confirmed,
      unresolved,
    };
  }
  if (gap > 1) {
    confirmed.push("books_reserve_exceeds_charge_residual");
    unresolved.push("proceeds_may_have_left_via_payout_or_other_movement");
    return {
      code: "BOOKS_RESERVE_EXCEEDS_CHARGE_RESIDUAL",
      booksReserveMinor,
      stripeImpliedHoldMinor: hold,
      gapBooksMinusStripeHold: gap,
      confirmed,
      unresolved,
    };
  }
  unresolved.push("charge_residual_exceeds_books_reserve");
  return {
    code: "CHARGE_RESIDUAL_EXCEEDS_BOOKS",
    booksReserveMinor,
    stripeImpliedHoldMinor: hold,
    gapBooksMinusStripeHold: gap,
    confirmed,
    unresolved,
  };
}

/**
 * Demonstrate what the GP funding allocator would decide for the £40.25 purchase.
 * Live platformRoom also subtracts Connect reserves and other GP unpaid nets.
 */
export function demonstrateGpFundingAgainstReserves(input: {
  availableMinor: number;
  pendingTransferAndFundingMinor: number;
  connectOutstandingReserveMinor: number;
  gpChargeNetMinor: number;
  gpPostedMinor: number;
  gpPrincipalMinor: number;
  gpFeeMinor: number;
  chargeAvailable: boolean;
  now: Date;
}): {
  withCurrentPlannerReserve: ReturnType<typeof allocateGpProceedsFunding>;
  withConnectReservesIncluded: ReturnType<typeof allocateGpProceedsFunding>;
  currentPlannerReservedMinor: number;
  protectedConnectReserveMinor: number;
} {
  const charge = {
    ok: true as const,
    chargeId: "ch_demo",
    currency: "GBP",
    netMinor: input.gpChargeNetMinor,
    available: input.chargeAvailable,
    availableOn: null,
    balanceTransactionId: "txn_demo",
  };
  const base: Omit<AllocateFundingInput, "platformAvailableMinor" | "reservedMinor" | "otherInFlightMinor"> = {
    payoutRail: "STRIPE_GLOBAL_PAYOUTS",
    stripeMode: "TEST",
    initiationAllowed: true,
    currency: "GBP",
    principalMinor: input.gpPrincipalMinor,
    payoutFeeMinor: input.gpFeeMinor,
    charge,
    postedMinor: input.gpPostedMinor,
    pendingMinor: 0,
    txnStatus: "READY_TO_RELEASE",
    openDispute: false,
    now: input.now,
    chargePayoutMembership: { state: "clear" },
  };
  const currentPlannerReservedMinor = Math.max(0, input.pendingTransferAndFundingMinor);
  const withCurrentPlannerReserve = allocateGpProceedsFunding({
    ...base,
    platformAvailableMinor: input.availableMinor,
    reservedMinor: currentPlannerReservedMinor,
    otherInFlightMinor: 0,
  });
  const protectedConnectReserveMinor = Math.max(0, input.connectOutstandingReserveMinor);
  const withConnectReservesIncluded = allocateGpProceedsFunding({
    ...base,
    platformAvailableMinor: input.availableMinor,
    reservedMinor: currentPlannerReservedMinor + protectedConnectReserveMinor,
    otherInFlightMinor: 0,
  });
  return {
    withCurrentPlannerReserve,
    withConnectReservesIncluded,
    currentPlannerReservedMinor,
    protectedConnectReserveMinor,
  };
}

export function shapePlatformPayoutEvidence(rows: readonly {
  amount?: number;
  currency?: string;
  status?: string;
  livemode?: boolean;
  arrival_date?: number;
  created?: number;
  automatic?: boolean;
}[]): {
  currency: string;
  amountMinor: number;
  status: string;
  automatic: boolean | null;
  createdAt: string | null;
  arrivalOn: string | null;
}[] {
  const out = [];
  for (const row of rows) {
    if (row.livemode === true) continue;
    const currency = typeof row.currency === "string" ? row.currency.trim().toUpperCase() : "";
    if (!/^[A-Z]{3}$/.test(currency)) continue;
    if (typeof row.amount !== "number" || !Number.isInteger(row.amount)) continue;
    out.push({
      currency,
      amountMinor: row.amount,
      status: typeof row.status === "string" ? row.status : "unknown",
      automatic: typeof row.automatic === "boolean" ? row.automatic : null,
      createdAt: typeof row.created === "number" ? new Date(row.created * 1000).toISOString() : null,
      arrivalOn:
        typeof row.arrival_date === "number" ? new Date(row.arrival_date * 1000).toISOString() : null,
    });
  }
  return out;
}
