import { isDirectPaymentOption } from "@/lib/payments/payment-option";

/**
 * TEST: 72 hours after seller `shippedAt`. After this window an **admin** may
 * authorize residual release if the buyer has not confirmed receipt.
 *
 * Not automatic seller release. Not cron auto-release. Do not scatter
 * this duration as a magic number — import this constant.
 */
export const BUYER_INACTIVITY_ADMIN_RELEASE_MS = 72 * 60 * 60 * 1000;

const INACTIVITY_RELEASE_ELIGIBLE_STATUSES = [
  "AWAITING_SHIPMENT",
  "IN_TRANSIT",
  "DELIVERED",
] as const;

export function listingProtectedShipmentPhotoRequired(opts: {
  origin?: string | null;
  paymentOption?: string | null;
}): boolean {
  return (
    opts.origin === "PRODUCT_CHECKOUT" &&
    !isDirectPaymentOption(opts.paymentOption || "PROTECTED")
  );
}

export function adminMayReleaseAfterBuyerInactivity(opts: {
  origin?: string | null;
  paymentOption?: string | null;
  status: string;
  shippedAt?: Date | string | null;
  deliveredAt?: Date | string | null;
  openDispute?: boolean;
  remainingSellerShareMinor?: number;
  now?: Date;
}): { ok: boolean; code?: string; windowEndsAt?: Date } {
  if (opts.origin !== "PRODUCT_CHECKOUT") {
    return { ok: false, code: "NOT_LISTING" };
  }
  if (isDirectPaymentOption(opts.paymentOption || "")) {
    return { ok: false, code: "DIRECT" };
  }
  if (opts.openDispute) return { ok: false, code: "OPEN_DISPUTE" };
  if (opts.deliveredAt) return { ok: false, code: "BUYER_ALREADY_RECEIVED" };
  if ((opts.remainingSellerShareMinor ?? 0) <= 0) {
    return { ok: false, code: "NOTHING_TO_RELEASE" };
  }
  if (
    [
      "RELEASED",
      "REFUNDED",
      "CANCELLED",
      "FAILED",
      "DISPUTED",
      "IN_INSPECTION",
      "READY_TO_RELEASE",
    ].includes(opts.status)
  ) {
    return { ok: false, code: "INVALID_STATUS" };
  }
  if (
    !(INACTIVITY_RELEASE_ELIGIBLE_STATUSES as readonly string[]).includes(
      opts.status,
    )
  ) {
    return { ok: false, code: "INVALID_STATUS" };
  }
  if (!opts.shippedAt) return { ok: false, code: "NOT_SHIPPED" };
  const shippedAt = new Date(opts.shippedAt);
  if (Number.isNaN(shippedAt.getTime())) return { ok: false, code: "NOT_SHIPPED" };
  const windowEndsAt = new Date(
    shippedAt.getTime() + BUYER_INACTIVITY_ADMIN_RELEASE_MS,
  );
  const now = opts.now ?? new Date();
  if (now.getTime() < windowEndsAt.getTime()) {
    return { ok: false, code: "WINDOW_OPEN", windowEndsAt };
  }
  return { ok: true, windowEndsAt };
}
