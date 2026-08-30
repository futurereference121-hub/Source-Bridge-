/**
 * Canonical listed-product / protected-txn display projection.
 * Does not mutate financial status — UI labels only.
 */

export type PurchaseDisplayPhase =
  | "AWAITING_PAYMENT"
  | "AWAITING_SHIPMENT"
  | "SHIPPED_AWAITING_BUYER"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "IN_INSPECTION"
  | "READY_TO_RELEASE"
  | "COMPLETED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED"
  | "UNDER_REVIEW"
  | "CANCELLED"
  | "FAILED";

export type PurchaseDisplayState = {
  phase: PurchaseDisplayPhase;
  label: string;
  shortLabel: string;
};

export type PurchaseDisplayInput = {
  status: string;
  paymentOption?: string | null;
  origin?: string | null;
  shippedAt?: Date | string | null;
  trackingNumber?: string | null;
  shipmentPhotoUrl?: string | null;
  deliveredAt?: Date | string | null;
  inspectionEndsAt?: Date | string | null;
  releasedAt?: Date | string | null;
  fundedAt?: Date | string | null;
  /** OPEN / UNDER_REVIEW dispute on this txn (optional; status DISPUTED also maps). */
  openDispute?: boolean;
};

export function hasShippingEvidence(
  input: Pick<
    PurchaseDisplayInput,
    "shippedAt" | "trackingNumber" | "shipmentPhotoUrl"
  >,
): boolean {
  return Boolean(
    input.shippedAt ||
      (input.trackingNumber && input.trackingNumber.trim()) ||
      (input.shipmentPhotoUrl && input.shipmentPhotoUrl.trim()),
  );
}

/** Stale-response guard for orders list polling. */
export function shouldApplyOrdersPayload(opts: {
  requestSeq: number;
  latestSeq: number;
  incomingVersion: number;
  appliedVersion: number;
}): boolean {
  if (opts.requestSeq < opts.latestSeq) return false;
  if (opts.incomingVersion <= opts.appliedVersion) return false;
  return true;
}

export function derivePurchaseDisplayState(
  input: PurchaseDisplayInput,
): PurchaseDisplayState {
  const status = input.status;
  const shipped = hasShippingEvidence(input);

  if (status === "RELEASED" || input.releasedAt) {
    return {
      phase: "COMPLETED",
      label: "Completed",
      shortLabel: "COMPLETED",
    };
  }
  if (status === "REFUNDED") {
    return {
      phase: "REFUNDED",
      label: "Refunded",
      shortLabel: "REFUNDED",
    };
  }
  if (status === "PARTIALLY_REFUNDED") {
    return {
      phase: "PARTIALLY_REFUNDED",
      label: "Partially refunded",
      shortLabel: "PARTIALLY REFUNDED",
    };
  }
  if (status === "CANCELLED") {
    return {
      phase: "CANCELLED",
      label: "Cancelled",
      shortLabel: "CANCELLED",
    };
  }
  if (status === "FAILED") {
    return {
      phase: "FAILED",
      label: "Failed",
      shortLabel: "FAILED",
    };
  }

  if (input.openDispute || status === "DISPUTED") {
    return {
      phase: "UNDER_REVIEW",
      label: "Under review by Source Bridge",
      shortLabel: "UNDER REVIEW",
    };
  }

  if (status === "IN_INSPECTION") {
    return {
      phase: "IN_INSPECTION",
      label: "Inspection active",
      shortLabel: "IN INSPECTION",
    };
  }
  if (status === "READY_TO_RELEASE") {
    return {
      phase: "READY_TO_RELEASE",
      label: "Ready to release residual",
      shortLabel: "READY TO RELEASE",
    };
  }
  if (status === "DELIVERED" || input.deliveredAt) {
    return {
      phase: "DELIVERED",
      label: "Delivered — awaiting buyer decision",
      shortLabel: "DELIVERED",
    };
  }

  if (status === "IN_TRANSIT") {
    return {
      phase: "IN_TRANSIT",
      label: "In transit",
      shortLabel: "IN TRANSIT",
    };
  }
  if (
    shipped &&
    ["AWAITING_SHIPMENT", "FUNDED", "PROCUREMENT_RELEASED"].includes(status)
  ) {
    return {
      phase: "SHIPPED_AWAITING_BUYER",
      label: "Shipped — awaiting buyer confirmation",
      shortLabel: "SHIPPED — AWAITING BUYER CONFIRMATION",
    };
  }

  if (["FUNDED", "PROCUREMENT_RELEASED"].includes(status)) {
    return {
      phase: "AWAITING_SHIPMENT",
      label: "Awaiting shipment",
      shortLabel: "AWAITING SHIPMENT",
    };
  }

  if (
    ["AWAITING_PAYMENT", "ACCEPTED", "AWAITING_ACCEPTANCE", "DRAFT"].includes(
      status,
    )
  ) {
    return {
      phase: "AWAITING_PAYMENT",
      label: "Awaiting payment",
      shortLabel: "AWAITING PAYMENT",
    };
  }

  const fallback = status.replace(/_/g, " ");
  return {
    phase: status as PurchaseDisplayPhase,
    label: fallback,
    shortLabel: fallback.toUpperCase(),
  };
}
