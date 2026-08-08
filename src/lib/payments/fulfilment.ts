import { prisma } from "@/lib/db";
import { getPlatformPaymentConfig } from "@/lib/payments/config";
import { assertPaymentsTestAllowlisted } from "@/lib/payments/allowlist";
import {
  isPaymentsEnabled,
  isProtectedPaymentsEnabled,
  isDirectPaymentsEnabled,
  isProcurementAdvancesEnabled,
} from "@/lib/payments/flags";
import { recordAuditEvent } from "@/lib/payments/ledger";
import {
  canTransition,
  nextStatus,
  type ProtectedStatus,
} from "@/lib/payments/state-machine";
import { isDirectPaymentOption } from "@/lib/payments/payment-option";
import { computeProtectedFinancials } from "@/lib/payments/breakdown";

export type ProtectedTxnListRole = "buyer" | "seller";

function assertFulfilmentAccess() {
  if (
    !isPaymentsEnabled() ||
    (!isProtectedPaymentsEnabled() && !isDirectPaymentsEnabled())
  ) {
    throw Object.assign(new Error("Payments are not enabled"), {
      status: 503,
      code: "PAYMENTS_DISABLED",
    });
  }
}

export function mapProtectedTxnSummary(
  t: {
    id: string;
    status: string;
    origin: string;
    paymentOption: string;
    title: string;
    currency: string;
    totalChargeMinor: number;
    protectionFeeMinor: number;
    itemCostMinor: number;
    shippingMinor: number;
    sellerServiceFeeMinor: number;
    procurementAdvanceAgreed?: boolean;
    procurementAdvanceMinor?: number;
    procurementTransferredMinor?: number;
    finalTransferredMinor?: number;
    refundedMinor?: number;
    stripeMode: string;
    fundedAt: Date | null;
    procurementReleasedAt?: Date | null;
    shippedAt: Date | null;
    deliveredAt: Date | null;
    inspectionEndsAt: Date | null;
    releasedAt: Date | null;
    trackingNumber: string;
    trackingCarrier: string;
    trackingStatus: string;
    createdAt: Date;
    listingId: string | null;
    listing?: {
      id: string;
      slug: string;
      name: string;
      saleStatus: string;
    } | null;
    buyer?: {
      id: string;
      username: string | null;
      name: string;
      slug: string | null;
    } | null;
    seller?: {
      id: string;
      username: string | null;
      name: string;
      slug: string | null;
    } | null;
  },
  viewerRole: ProtectedTxnListRole,
  opts?: { procurementFlagOn?: boolean },
) {
  const shipped = Boolean(t.shippedAt || t.trackingNumber);
  const books = computeProtectedFinancials({
    itemCostMinor: t.itemCostMinor,
    shippingMinor: t.shippingMinor,
    sellerServiceFeeMinor: t.sellerServiceFeeMinor,
    protectionFeeMinor: t.protectionFeeMinor,
    totalChargeMinor: t.totalChargeMinor,
    procurementAdvanceAgreed: t.procurementAdvanceAgreed,
    procurementAdvanceMinor: t.procurementAdvanceMinor,
    procurementTransferredMinor: t.procurementTransferredMinor,
    finalTransferredMinor: t.finalTransferredMinor,
    refundedMinor: t.refundedMinor,
  });
  const canReleaseProcurement =
    Boolean(opts?.procurementFlagOn) &&
    viewerRole === "buyer" &&
    !isDirectPaymentOption(t.paymentOption) &&
    t.status === "FUNDED" &&
    Boolean(t.procurementAdvanceAgreed) &&
    (t.procurementAdvanceMinor ?? 0) > 0 &&
    (t.procurementTransferredMinor ?? 0) === 0;

  return {
    id: t.id,
    status: t.status,
    origin: t.origin,
    paymentOption: t.paymentOption,
    title: t.title,
    currency: t.currency,
    totalChargeMinor: t.totalChargeMinor,
    protectionFeeMinor: t.protectionFeeMinor,
    itemCostMinor: t.itemCostMinor,
    shippingMinor: t.shippingMinor,
    sellerServiceFeeMinor: t.sellerServiceFeeMinor,
    procurementAdvanceAgreed: Boolean(t.procurementAdvanceAgreed),
    procurementAdvanceMinor: t.procurementAdvanceMinor ?? 0,
    procurementTransferredMinor: t.procurementTransferredMinor ?? 0,
    books,
    stripeMode: t.stripeMode,
    fundedAt: t.fundedAt?.toISOString() ?? null,
    procurementReleasedAt: t.procurementReleasedAt?.toISOString() ?? null,
    shippedAt: t.shippedAt?.toISOString() ?? null,
    deliveredAt: t.deliveredAt?.toISOString() ?? null,
    inspectionEndsAt: t.inspectionEndsAt?.toISOString() ?? null,
    releasedAt: t.releasedAt?.toISOString() ?? null,
    trackingNumber: t.trackingNumber || "",
    trackingCarrier: t.trackingCarrier || "",
    trackingStatus: t.trackingStatus || "",
    createdAt: t.createdAt.toISOString(),
    listing: t.listing
      ? {
          id: t.listing.id,
          slug: t.listing.slug,
          name: t.listing.name,
          saleStatus: t.listing.saleStatus,
        }
      : t.listingId
        ? { id: t.listingId, slug: "", name: t.title, saleStatus: "" }
        : null,
    counterparty:
      viewerRole === "seller"
        ? t.buyer
          ? {
              id: t.buyer.id,
              username: t.buyer.username,
              name: t.buyer.name,
              slug: t.buyer.slug,
            }
          : null
        : t.seller
          ? {
              id: t.seller.id,
              username: t.seller.username,
              name: t.seller.name,
              slug: t.seller.slug,
            }
          : null,
    labels: {
      payment: paymentLabel(
        t.status,
        t.paymentOption,
        Boolean(t.procurementAdvanceAgreed && (t.procurementTransferredMinor ?? 0) > 0),
      ),
      shipping: shippingLabel(t.status, shipped, t.paymentOption),
      delivery: deliveryLabel(t.status, t.paymentOption),
    },
    actions: {
      canAddTracking:
        viewerRole === "seller" &&
        !isDirectPaymentOption(t.paymentOption) &&
        ["FUNDED", "PROCUREMENT_RELEASED", "AWAITING_SHIPMENT"].includes(
          t.status,
        ) &&
        !t.trackingNumber,
      canRefreshTracking:
        !isDirectPaymentOption(t.paymentOption) &&
        shipped &&
        t.trackingNumber &&
        !["RELEASED", "REFUNDED", "CANCELLED"].includes(t.status),
      canConfirmReceipt:
        viewerRole === "buyer" &&
        !isDirectPaymentOption(t.paymentOption) &&
        shipped &&
        ["AWAITING_SHIPMENT", "IN_TRANSIT", "DELIVERED"].includes(t.status),
      canReleaseProcurement,
      /** Sourcer/seller never releases item funds. */
      canSellerReleaseProcurement: false,
    },
  };
}

function paymentLabel(status: string, option: string, procReleased = false) {
  if (isDirectPaymentOption(option)) {
    if (status === "RELEASED") return "Direct Payment — completed";
    if (status === "FUNDED") {
      return "Direct Payment — payment received (payout processing)";
    }
    if (status === "AWAITING_PAYMENT" || status === "ACCEPTED") {
      return "Direct Payment — awaiting payment";
    }
    if (status === "REFUNDED" || status === "PARTIALLY_REFUNDED") return "Refunded";
    if (status === "DISPUTED") return "Disputed";
    return `Direct Payment — ${status}`;
  }
  if (status === "FUNDED" && !procReleased) {
    return "Funded — held protected (buyer has not released item funds)";
  }
  if (status === "PROCUREMENT_RELEASED" || procReleased) {
    if (status === "PROCUREMENT_RELEASED") {
      return "Item funds released — remaining amount still protected";
    }
    // Later statuses after early procurement
    if (["AWAITING_SHIPMENT", "IN_TRANSIT", "FUNDED"].includes(status)) {
      return "Partially protected — item funds already released to sourcer";
    }
  }
  if (status === "FUNDED" || status === "AWAITING_SHIPMENT" || status === "IN_TRANSIT") {
    return procReleased
      ? "Partially protected — item funds already released to sourcer"
      : "Funded / Protected";
  }
  if (status === "IN_INSPECTION") return "Funded — inspection active";
  if (status === "READY_TO_RELEASE") return "Ready to release residual";
  if (status === "RELEASED") return "Released to seller";
  if (status === "REFUNDED" || status === "PARTIALLY_REFUNDED") return "Refunded";
  if (status === "DISPUTED") return "Disputed";
  return status;
}

function shippingLabel(status: string, shipped: boolean, option: string) {
  if (isDirectPaymentOption(option)) {
    if (status === "RELEASED" || status === "FUNDED") {
      return shipped ? "Tracking optional" : "No inspection hold";
    }
    return shipped ? "Shipped" : "Not required for release";
  }
  if (!shipped && (status === "FUNDED" || status === "ACCEPTED" || status === "AWAITING_PAYMENT")) {
    return "Waiting for seller to ship";
  }
  if (shipped && ["AWAITING_SHIPMENT", "IN_TRANSIT", "FUNDED"].includes(status)) {
    return "Item shipped";
  }
  if (status === "DELIVERED" || status === "IN_INSPECTION" || status === "READY_TO_RELEASE") {
    return "Item shipped";
  }
  if (status === "RELEASED") return "Completed";
  return shipped ? "Shipped" : "Not shipped";
}

function deliveryLabel(status: string, option: string) {
  if (isDirectPaymentOption(option)) {
    if (status === "RELEASED") {
      return "Funds routed to seller (Destination Charges · no Source Bridge protection)";
    }
    if (status === "FUNDED") {
      return "Payment received — seller destination payout processing";
    }
    return "Direct Payment — no inspection period";
  }
  if (status === "IN_INSPECTION") {
    return "Delivery confirmed — inspection period active";
  }
  if (status === "DELIVERED") return "Delivered";
  if (status === "READY_TO_RELEASE") return "Inspection complete";
  if (status === "RELEASED") return "Complete";
  if (status === "IN_TRANSIT") return "In transit";
  return "Pending delivery";
}

export async function listProtectedOrdersForUser(opts: {
  userId: string;
  email?: string | null;
  role: ProtectedTxnListRole;
}) {
  assertFulfilmentAccess();
  assertPaymentsTestAllowlisted(
    { id: opts.userId, email: opts.email },
    { action: "view protected orders" },
  );

  const where =
    opts.role === "seller"
      ? { sellerId: opts.userId }
      : { buyerId: opts.userId };

  const rows = await prisma.protectedTransaction.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: {
      listing: {
        select: { id: true, slug: true, name: true, saleStatus: true },
      },
      buyer: {
        select: { id: true, username: true, name: true, slug: true },
      },
      seller: {
        select: { id: true, username: true, name: true, slug: true },
      },
    },
  });

  return rows.map((t) =>
    mapProtectedTxnSummary(t, opts.role, {
      procurementFlagOn: isProcurementAdvancesEnabled(),
    }),
  );
}

/**
 * Buyer confirms physical receipt → IN_INSPECTION (no money movement).
 */
export async function confirmReceipt(opts: {
  protectedTxnId: string;
  buyerId: string;
  buyerEmail?: string | null;
}) {
  assertFulfilmentAccess();

  const txn = await prisma.protectedTransaction.findUnique({
    where: { id: opts.protectedTxnId },
  });
  if (!txn) {
    throw Object.assign(new Error("Transaction not found"), { status: 404 });
  }
  if (txn.buyerId !== opts.buyerId) {
    throw Object.assign(new Error("Only the buyer can confirm receipt"), {
      status: 403,
      code: "BUYER_ONLY",
    });
  }

  const buyer = await prisma.user.findUnique({
    where: { id: opts.buyerId },
    select: { id: true, email: true },
  });
  const seller = await prisma.user.findUnique({
    where: { id: txn.sellerId },
    select: { id: true, email: true },
  });
  if (!buyer || !seller) {
    throw Object.assign(new Error("Party not found"), { status: 404 });
  }
  assertPaymentsTestAllowlisted([buyer, seller], {
    action: "confirm receipt",
    labels: ["buyer", "seller"],
  });

  const status = txn.status as ProtectedStatus;

  // Idempotent if inspection already active or past inspection.
  if (
    status === "IN_INSPECTION" ||
    status === "READY_TO_RELEASE" ||
    status === "RELEASED"
  ) {
    return {
      alreadyConfirmed: true,
      transaction: txn,
    };
  }

  const shipped = Boolean(txn.shippedAt || txn.trackingNumber);
  if (!shipped) {
    throw Object.assign(
      new Error("Cannot confirm receipt before the seller ships the item"),
      { status: 409, code: "NOT_SHIPPED" },
    );
  }

  if (!canTransition(status, "CONFIRM_RECEIPT")) {
    throw Object.assign(
      new Error(`Cannot confirm receipt from status ${status}`),
      { status: 409, code: "INVALID_TRANSITION" },
    );
  }

  const config = await getPlatformPaymentConfig();
  const inspectionEnds = new Date();
  inspectionEnds.setHours(inspectionEnds.getHours() + config.inspectionHours);

  const next = nextStatus(status, "CONFIRM_RECEIPT");
  const updated = await prisma.protectedTransaction.update({
    where: { id: txn.id },
    data: {
      status: next,
      deliveredAt: txn.deliveredAt ?? new Date(),
      inspectionEndsAt: inspectionEnds,
    },
  });

  await recordAuditEvent({
    protectedTxnId: txn.id,
    actorUserId: opts.buyerId,
    action: "CONFIRM_RECEIPT",
    meta: {
      inspectionEndsAt: inspectionEnds.toISOString(),
      transferTriggered: false,
    },
  });

  return { alreadyConfirmed: false, transaction: updated };
}
