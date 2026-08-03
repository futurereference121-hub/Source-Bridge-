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
  COMPLETE_INSPECTION: {
    IN_INSPECTION: "READY_TO_RELEASE",
    DELIVERED: "READY_TO_RELEASE",
  },
  RELEASE_FINAL: {
    READY_TO_RELEASE: "RELEASED",
    // Instant path: release promptly after funding when no protection hold.
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
    FUNDED: "REFUNDED",
    PROCUREMENT_RELEASED: "PARTIALLY_REFUNDED",
    AWAITING_SHIPMENT: "REFUNDED",
    IN_TRANSIT: "REFUNDED",
    DELIVERED: "REFUNDED",
    IN_INSPECTION: "REFUNDED",
    READY_TO_RELEASE: "REFUNDED",
    DISPUTED: "REFUNDED",
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
