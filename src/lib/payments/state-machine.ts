/**
 * Protected Transaction state machine.
 * Transitions only via explicit domain actions — no generic status PATCH.
 */

export const PROTECTED_STATUSES = [
  "DRAFT",
  "AWAITING_ACCEPTANCE",
  "ACCEPTED",
  "AWAITING_PAYMENT",
  "FUNDED",
  "PROCUREMENT_RELEASED",
  "AWAITING_SHIPMENT",
  "IN_TRANSIT",
  "DELIVERED",
  "IN_INSPECTION",
  "READY_TO_RELEASE",
  "RELEASED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "DISPUTED",
  "CANCELLED",
  "FAILED",
] as const;

export type ProtectedStatus = (typeof PROTECTED_STATUSES)[number];

export type DomainAction =
  | "PROPOSE_TERMS"
  | "ACCEPT_TERMS"
  | "DECLINE_TERMS"
  | "START_CHECKOUT"
  | "MARK_FUNDED"
  | "RELEASE_PROCUREMENT"
  | "ADD_TRACKING"
  | "TRACKING_IN_TRANSIT"
  | "TRACKING_DELIVERED"
  | "START_INSPECTION"
  | "CONFIRM_RECEIPT"
  /** Buyer chooses immediate residual release (bypass remaining inspection). */
  | "BUYER_RELEASE_NOW"
  | "COMPLETE_INSPECTION"
  | "RELEASE_FINAL"
  | "OPEN_DISPUTE"
  | "RESOLVE_DISPUTE"
  | "REFUND"
  | "CANCEL"
  | "FAIL";

const TRANSITIONS: Record<DomainAction, Partial<Record<ProtectedStatus, ProtectedStatus>>> = {
  PROPOSE_TERMS: {
    DRAFT: "AWAITING_ACCEPTANCE",
  },
  ACCEPT_TERMS: {
    AWAITING_ACCEPTANCE: "ACCEPTED",
    DRAFT: "ACCEPTED",
  },
  DECLINE_TERMS: {
    AWAITING_ACCEPTANCE: "CANCELLED",
    DRAFT: "CANCELLED",
    ACCEPTED: "CANCELLED",
  },
  START_CHECKOUT: {
    ACCEPTED: "AWAITING_PAYMENT",
    /** Reuse / refresh client secret — no status change. */
    AWAITING_PAYMENT: "AWAITING_PAYMENT",
  },
  MARK_FUNDED: {
    AWAITING_PAYMENT: "FUNDED",
    ACCEPTED: "FUNDED",
  },
  RELEASE_PROCUREMENT: {
    FUNDED: "PROCUREMENT_RELEASED",
  },
  ADD_TRACKING: {
    FUNDED: "AWAITING_SHIPMENT",
    PROCUREMENT_RELEASED: "AWAITING_SHIPMENT",
    AWAITING_SHIPMENT: "AWAITING_SHIPMENT",
  },
  TRACKING_IN_TRANSIT: {
    AWAITING_SHIPMENT: "IN_TRANSIT",
    FUNDED: "IN_TRANSIT",
    PROCUREMENT_RELEASED: "IN_TRANSIT",
  },
  TRACKING_DELIVERED: {
    IN_TRANSIT: "DELIVERED",
    AWAITING_SHIPMENT: "DELIVERED",
  },
  START_INSPECTION: {
    DELIVERED: "IN_INSPECTION",
  },
  /**
   * Buyer “Confirm item received” after seller shipped.
   * Records receipt only (DELIVERED). Does not start inspection or release.
   * Never from FUNDED without shipment. Never jumps to RELEASED.
   */
  CONFIRM_RECEIPT: {
    AWAITING_SHIPMENT: "DELIVERED",
    IN_TRANSIT: "DELIVERED",
    DELIVERED: "DELIVERED",
  },
  /**
   * Buyer “Release funds now” — marks ready for residual releaseFinal only.
   * Never jumps straight to RELEASED (money path stays in releaseFinal).
   */
  BUYER_RELEASE_NOW: {
    AWAITING_SHIPMENT: "READY_TO_RELEASE",
    IN_TRANSIT: "READY_TO_RELEASE",
    DELIVERED: "READY_TO_RELEASE",
    IN_INSPECTION: "READY_TO_RELEASE",
    READY_TO_RELEASE: "READY_TO_RELEASE",
  },
  COMPLETE_INSPECTION: {
    IN_INSPECTION: "READY_TO_RELEASE",
    DELIVERED: "READY_TO_RELEASE",
  },
  RELEASE_FINAL: {
    /** Protected: only after inspection window / READY_TO_RELEASE. */
    READY_TO_RELEASE: "RELEASED",
    /**
     * Admin residual release after controlled partial refund on a payment issue.
     * releaseFinal still pays residual-only amounts from books.
     */
    PARTIALLY_REFUNDED: "RELEASED",
    /**
     * Instant path only is allowed to release from FUNDED.
     * releaseFinal() still blocks PROTECTED + FUNDED explicitly.
     */
    FUNDED: "RELEASED",
    PROCUREMENT_RELEASED: "RELEASED",
  },
  OPEN_DISPUTE: {
    FUNDED: "DISPUTED",
    PROCUREMENT_RELEASED: "DISPUTED",
    AWAITING_SHIPMENT: "DISPUTED",
    IN_TRANSIT: "DISPUTED",
    DELIVERED: "DISPUTED",
    IN_INSPECTION: "DISPUTED",
    READY_TO_RELEASE: "DISPUTED",
  },
  RESOLVE_DISPUTE: {
    DISPUTED: "READY_TO_RELEASE",
  },
  REFUND: {
    /** Full refund only safe before any seller transfer; books may still mark PARTIAL. */
    FUNDED: "REFUNDED",
    PROCUREMENT_RELEASED: "PARTIALLY_REFUNDED",
    /** If procurement already left, refund path sets PARTIALLY_REFUNDED via books. */
    AWAITING_SHIPMENT: "PARTIALLY_REFUNDED",
    IN_TRANSIT: "PARTIALLY_REFUNDED",
    DELIVERED: "PARTIALLY_REFUNDED",
    IN_INSPECTION: "PARTIALLY_REFUNDED",
    READY_TO_RELEASE: "PARTIALLY_REFUNDED",
    DISPUTED: "PARTIALLY_REFUNDED",
    AWAITING_PAYMENT: "CANCELLED",
  },
  CANCEL: {
    DRAFT: "CANCELLED",
    AWAITING_ACCEPTANCE: "CANCELLED",
    ACCEPTED: "CANCELLED",
    AWAITING_PAYMENT: "CANCELLED",
  },
  FAIL: {
    AWAITING_PAYMENT: "FAILED",
  },
};

export function canTransition(
  from: ProtectedStatus,
  action: DomainAction,
): boolean {
  return Boolean(TRANSITIONS[action]?.[from]);
}

export function nextStatus(
  from: ProtectedStatus,
  action: DomainAction,
): ProtectedStatus {
  const next = TRANSITIONS[action]?.[from];
  if (!next) {
    throw Object.assign(
      new Error(`Invalid transition: ${action} from ${from}`),
      { status: 409, code: "INVALID_TRANSITION" },
    );
  }
  return next;
}

export function isTerminal(status: ProtectedStatus): boolean {
  return (
    status === "RELEASED" ||
    status === "REFUNDED" ||
    status === "CANCELLED" ||
    status === "FAILED"
  );
}

export function isFundedOrLater(status: ProtectedStatus): boolean {
  return ![
    "DRAFT",
    "AWAITING_ACCEPTANCE",
    "ACCEPTED",
    "AWAITING_PAYMENT",
    "CANCELLED",
    "FAILED",
  ].includes(status);
}
