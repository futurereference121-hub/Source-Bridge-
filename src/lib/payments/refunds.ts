/**
 * Shared refund helpers — dispute resolution and any future buyer refund path.
 * Never reverse seller transfers; refund only what remains on the platform.
 */

import {
  computeProtectedFinancials,
  type ProtectedFinancialInput,
} from "@/lib/payments/breakdown";
import {
  canTransition,
  type ProtectedStatus,
} from "@/lib/payments/state-machine";

export type RefundPlan = {
  requestedMinor: number;
  refundableMinor: number;
  amountMinor: number;
  /** Domain status after applying this refund. */
  nextStatus: "REFUNDED" | "PARTIALLY_REFUNDED";
  /** True when any seller transfer has already left the platform. */
  partialBecauseOfTransfers: boolean;
  blockedReason?: string;
};

/**
 * Safe amount that may be refunded via Stripe refunds.create without reverse.
 */
export function maxRefundableMinor(input: ProtectedFinancialInput): number {
  return computeProtectedFinancials(input).refundableMinor;
}

/**
 * Plan a refund against current protected-txn books.
 * Clamps to refundable remainder; refuses silent reverse-transfer.
 */
export function planProtectedRefund(
  input: ProtectedFinancialInput & {
    status: string;
    requestedMinor: number;
  },
): RefundPlan {
  const books = computeProtectedFinancials(input);
  const requested = Math.max(0, Math.floor(input.requestedMinor));
  const refundable = books.refundableMinor;
  const amountMinor = Math.min(requested, refundable);
  const partialBecauseOfTransfers = books.transferredTotalMinor > 0;
  const afterTotalRefunded = books.refundedMinor + amountMinor;
  const fullyRefundedGross =
    afterTotalRefunded >= books.grossFundedMinor &&
    !partialBecauseOfTransfers;

  if (amountMinor <= 0) {
    return {
      requestedMinor: requested,
      refundableMinor: refundable,
      amountMinor: 0,
      nextStatus: partialBecauseOfTransfers
        ? "PARTIALLY_REFUNDED"
        : "REFUNDED",
      partialBecauseOfTransfers,
      blockedReason:
        refundable <= 0
          ? partialBecauseOfTransfers
            ? "Nothing left on platform to refund (seller transfer already sent; reverse transfer is not automatic)"
            : "Nothing left to refund"
          : "Requested refund amount is zero",
    };
  }

  // Prefer PARTIALLY_REFUNDED when any transfer already left, or amount < full remaining.
  const nextStatus: "REFUNDED" | "PARTIALLY_REFUNDED" =
    fullyRefundedGross && amountMinor >= refundable && !partialBecauseOfTransfers
      ? "REFUNDED"
      : "PARTIALLY_REFUNDED";

  // Align with state machine preference when transition is known.
  const status = input.status as ProtectedStatus;
  if (canTransition(status, "REFUND")) {
    // After procurement the machine maps FUNDED→REFUNDED but PROCUREMENT_RELEASED→PARTIALLY.
    // Use books: any prior transfer forces partial.
    if (partialBecauseOfTransfers || nextStatus === "PARTIALLY_REFUNDED") {
      return {
        requestedMinor: requested,
        refundableMinor: refundable,
        amountMinor,
        nextStatus: "PARTIALLY_REFUNDED",
        partialBecauseOfTransfers,
      };
    }
  }

  return {
    requestedMinor: requested,
    refundableMinor: refundable,
    amountMinor,
    nextStatus,
    partialBecauseOfTransfers,
  };
}
