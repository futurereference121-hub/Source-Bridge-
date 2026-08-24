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

export {
  BUYER_INACTIVITY_ADMIN_RELEASE_MS,
  adminMayReleaseAfterBuyerInactivity,
  listingProtectedShipmentPhotoRequired,
} from "@/lib/payments/fulfilment-rules";

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

/**
 * Seller may mark shipped / add tracking on the existing fulfilment engine.
 * Origin-agnostic (PRODUCT_CHECKOUT and CHAT_TICKET).
 * Procurement agreed: only after item funds released (PROCUREMENT_RELEASED / transferred).
 * No procurement: after FUNDED (same as product protected).
 */
export function sellerCanAddTracking(opts: {
  paymentOption: string;
  status: string;
  trackingNumber?: string | null;
  procurementAdvanceAgreed?: boolean;
  procurementAdvanceMinor?: number;
  procurementTransferredMinor?: number;
}): boolean {
  if (isDirectPaymentOption(opts.paymentOption)) return false;
  if (opts.trackingNumber) return false;
  if (
    ["RELEASED", "REFUNDED", "PARTIALLY_REFUNDED", "CANCELLED", "DISPUTED", "FAILED"].includes(
      opts.status,
    )
  ) {
    return false;
  }
  if (
    !["FUNDED", "PROCUREMENT_RELEASED", "AWAITING_SHIPMENT"].includes(opts.status)
  ) {
    return false;
  }
  const procAgreed =
    Boolean(opts.procurementAdvanceAgreed) &&
    (opts.procurementAdvanceMinor ?? 0) > 0;
  if (procAgreed) {
    const transferred =
      (opts.procurementTransferredMinor ?? 0) > 0 ||
      opts.status === "PROCUREMENT_RELEASED";
    // After FUNDED but before item-fund release — wait (mirrors product timing with advance).
    if (opts.status === "FUNDED" && !transferred) return false;
  }
  return true;
}

export function buyerCanConfirmReceipt(opts: {
  paymentOption: string;
  status: string;
  shipped: boolean;
  deliveredAt?: Date | string | null;
  origin?: string | null;
}): boolean {
  if (opts.origin === "PRODUCT_CHECKOUT") return false;
  if (isDirectPaymentOption(opts.paymentOption)) return false;
  if (!opts.shipped) return false;
  if (opts.deliveredAt) return false;
  return ["AWAITING_SHIPMENT", "IN_TRANSIT", "DELIVERED"].includes(opts.status);
}

/** Buyer may release residual only after receipt is confirmed, or during inspection. */
export function buyerCanReleaseNow(opts: {
  paymentOption: string;
  status: string;
  shipped: boolean;
  deliveredAt?: Date | string | null;
  origin?: string | null;
}): boolean {
  if (opts.origin === "PRODUCT_CHECKOUT") return false;
  if (isDirectPaymentOption(opts.paymentOption)) return false;
  if (opts.status === "IN_INSPECTION" || opts.status === "READY_TO_RELEASE") {
    return true;
  }
  if (!opts.shipped) return false;
  if (!opts.deliveredAt) return false;
  return opts.status === "DELIVERED";
}

/**
 * Buyer may report a problem only during active inspection while residual
 * remains protected. Not offered on the initial receipt modal.
 * Product Purchase: buyer may report while funded/shipped without inspection authority.
 */
export function buyerCanReportIssue(opts: {
  paymentOption: string;
  status: string;
  /** When known, require remaining seller residual (or protected remainder). */
  residualMinor?: number;
  origin?: string | null;
}): boolean {
  if (isDirectPaymentOption(opts.paymentOption)) return false;
  if (opts.origin === "PRODUCT_CHECKOUT") {
    if (
      !["FUNDED", "PROCUREMENT_RELEASED", "AWAITING_SHIPMENT", "IN_TRANSIT", "DELIVERED", "IN_INSPECTION", "DISPUTED"].includes(
        opts.status,
      )
    ) {
      return false;
    }
  } else if (opts.status !== "IN_INSPECTION") {
    return false;
  }
  if (
    typeof opts.residualMinor === "number" &&
    opts.residualMinor <= 0
  ) {
    return false;
  }
  if (opts.origin === "PRODUCT_CHECKOUT") return true;
  return canTransition(opts.status as ProtectedStatus, "OPEN_DISPUTE");
}

export type ConfirmReceiptDecision =
  | "ACKNOWLEDGE"
  | "RELEASE_NOW"
  | "START_INSPECTION"
  | "REPORT_ISSUE";

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
    shipmentPhotoUrl?: string | null;
    createdAt: Date;
    listingId: string | null;
    conversationId?: string | null;
    listing?: {
      id: string;
      slug: string;
      name: string;
      saleStatus: string;
    } | null;
    paymentTicket?: { id: string } | null;
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
  const canAddTracking =
    viewerRole === "seller" &&
    sellerCanAddTracking({
      paymentOption: t.paymentOption,
      status: t.status,
      trackingNumber: t.trackingNumber,
      procurementAdvanceAgreed: t.procurementAdvanceAgreed,
      procurementAdvanceMinor: t.procurementAdvanceMinor,
      procurementTransferredMinor: t.procurementTransferredMinor,
    });

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
    shipmentPhotoUrl: t.shipmentPhotoUrl || "",
    createdAt: t.createdAt.toISOString(),
    conversationId: t.conversationId ?? null,
    paymentTicketId: t.paymentTicket?.id ?? null,
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
      canAddTracking,
      canMarkShipped: canAddTracking,
      canRefreshTracking:
        !isDirectPaymentOption(t.paymentOption) &&
        shipped &&
        Boolean(t.trackingNumber) &&
        !["RELEASED", "REFUNDED", "CANCELLED"].includes(t.status),
      canConfirmReceipt:
        viewerRole === "buyer" &&
        buyerCanConfirmReceipt({
          paymentOption: t.paymentOption,
          status: t.status,
          shipped,
          deliveredAt: t.deliveredAt,
          origin: t.origin,
        }),
      canReleaseNow:
        viewerRole === "buyer" &&
        buyerCanReleaseNow({
          paymentOption: t.paymentOption,
          status: t.status,
          shipped,
          deliveredAt: t.deliveredAt,
          origin: t.origin,
        }),
      canReportIssue:
        viewerRole === "buyer" &&
        buyerCanReportIssue({
          paymentOption: t.paymentOption,
          status: t.status,
          residualMinor: books.finalResidualMinor,
          origin: t.origin,
        }),
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
  if (status === "DELIVERED") return "Delivered — waiting for buyer decision";
  if (status === "IN_INSPECTION") return "Funded — inspection active";
  if (status === "READY_TO_RELEASE") return "Ready to release residual";
  if (status === "RELEASED") return "Completed — residual released to seller";
  if (status === "REFUNDED" || status === "PARTIALLY_REFUNDED") return "Refunded";
  if (status === "DISPUTED") return "Issue reported — remaining funds on hold";
  return status;
}

function shippingLabel(status: string, shipped: boolean, option: string) {
  if (isDirectPaymentOption(option)) {
    if (status === "RELEASED" || status === "FUNDED") {
      return shipped ? "Tracking optional" : "No inspection hold";
    }
    return shipped ? "Shipped" : "Not required for release";
  }
  if (
    !shipped &&
    (status === "FUNDED" ||
      status === "PROCUREMENT_RELEASED" ||
      status === "ACCEPTED" ||
      status === "AWAITING_PAYMENT")
  ) {
    return "Waiting for seller to ship";
  }
  if (
    shipped &&
    ["AWAITING_SHIPMENT", "IN_TRANSIT", "FUNDED", "PROCUREMENT_RELEASED"].includes(
      status,
    )
  ) {
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
    return "Delivery confirmed — inspection period active (buyer may release early)";
  }
  if (status === "DELIVERED") {
    return "Delivered — awaiting buyer decision (release now or start inspection)";
  }
  if (status === "READY_TO_RELEASE") return "Inspection complete — releasing residual";
  if (status === "RELEASED") return "Complete";
  if (status === "DISPUTED") {
    return "Issue reported — auto-release frozen; remaining funds protected";
  }
  if (status === "IN_TRANSIT") return "In transit";
  if (status === "AWAITING_SHIPMENT") return "Shipped — awaiting buyer confirmation";
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
      paymentTicket: { select: { id: true } },
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
 * Buyer Protected receipt decisions:
 * - ACKNOWLEDGE → deliveredAt + DELIVERED only (no inspection, no transfer)
 * - START_INSPECTION → after receipt: inspectionEndsAt, IN_INSPECTION, no transfer
 * - RELEASE_NOW → after receipt: READY_TO_RELEASE, existing releaseFinal residual only
 * - REPORT_ISSUE → only while IN_INSPECTION; DISPUTED / issue hold (cron skips)
 *
 * After ship the buyer confirms receipt once, then chooses Release Now or
 * Start Inspection. Report a Problem is available later during inspection.
 * Direct Payment is rejected. Idempotent for double-clicks and race with cron.
 */
export async function confirmReceipt(opts: {
  protectedTxnId: string;
  buyerId: string;
  buyerEmail?: string | null;
  decision?: ConfirmReceiptDecision;
  reason?: string;
  category?: string;
  details?: string;
}) {
  assertFulfilmentAccess();

  const decision: ConfirmReceiptDecision = opts.decision ?? "ACKNOWLEDGE";

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
  if (isDirectPaymentOption(txn.paymentOption)) {
    throw Object.assign(
      new Error("Buyer confirmation decisions do not apply to Direct Payment"),
      { status: 409, code: "DIRECT_NOT_SUPPORTED" },
    );
  }

  if (
    txn.origin === "PRODUCT_CHECKOUT" &&
    (decision === "RELEASE_NOW" ||
      decision === "START_INSPECTION" ||
      decision === "ACKNOWLEDGE")
  ) {
    throw Object.assign(
      new Error(
        "Product Purchase funds are released by Source Bridge admin only. You can report an item issue for review.",
      ),
      { status: 409, code: "PRODUCT_ADMIN_ONLY" },
    );
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

  if (decision === "RELEASE_NOW") {
    return releaseNowAfterReceipt({
      txn,
      buyerId: opts.buyerId,
    });
  }
  if (decision === "REPORT_ISSUE") {
    return reportIssueAfterReceipt({
      txn,
      buyerId: opts.buyerId,
      reason: opts.reason,
      category: opts.category,
      details: opts.details,
    });
  }
  if (decision === "START_INSPECTION") {
    return startInspectionAfterReceipt({
      txn,
      buyerId: opts.buyerId,
    });
  }
  return acknowledgeReceiptAfterShip({
    txn,
    buyerId: opts.buyerId,
  });
}

type TxnRow = {
  id: string;
  status: string;
  buyerId: string;
  sellerId: string;
  conversationId?: string | null;
  paymentOption: string;
  origin?: string | null;
  shippedAt: Date | null;
  trackingNumber: string;
  deliveredAt: Date | null;
  inspectionEndsAt: Date | null;
  releasedAt: Date | null;
};

async function acknowledgeReceiptAfterShip(opts: {
  txn: TxnRow;
  buyerId: string;
}) {
  const txn = opts.txn;
  const status = txn.status as ProtectedStatus;

  if (
    status === "IN_INSPECTION" ||
    status === "READY_TO_RELEASE" ||
    status === "RELEASED" ||
    (status === "DELIVERED" && txn.deliveredAt)
  ) {
    return {
      alreadyConfirmed: true,
      decision: "ACKNOWLEDGE" as const,
      transferTriggered: false,
      transaction: txn,
    };
  }

  if (status === "DISPUTED") {
    throw Object.assign(
      new Error("Cannot confirm receipt while an issue is open"),
      { status: 409, code: "DISPUTED" },
    );
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

  const next = nextStatus(status, "CONFIRM_RECEIPT");
  const updated = await prisma.protectedTransaction.update({
    where: { id: txn.id },
    data: {
      status: next,
      deliveredAt: txn.deliveredAt ?? new Date(),
    },
  });

  await recordAuditEvent({
    protectedTxnId: txn.id,
    actorUserId: opts.buyerId,
    action: "CONFIRM_RECEIPT",
    meta: {
      decision: "ACKNOWLEDGE",
      transferTriggered: false,
    },
  });

  return {
    alreadyConfirmed: false,
    decision: "ACKNOWLEDGE" as const,
    transferTriggered: false,
    transaction: updated,
  };
}

async function startInspectionAfterReceipt(opts: {
  txn: TxnRow;
  buyerId: string;
}) {
  let txn = opts.txn;
  let status = txn.status as ProtectedStatus;

  // Idempotent if inspection already active or past inspection.
  if (
    status === "IN_INSPECTION" ||
    status === "READY_TO_RELEASE" ||
    status === "RELEASED"
  ) {
    return {
      alreadyConfirmed: true,
      decision: "START_INSPECTION" as const,
      transferTriggered: false,
      transaction: txn,
    };
  }

  if (status === "DISPUTED") {
    throw Object.assign(
      new Error("Cannot start inspection while an issue is open"),
      { status: 409, code: "DISPUTED" },
    );
  }

  const shipped = Boolean(txn.shippedAt || txn.trackingNumber);
  if (!shipped) {
    throw Object.assign(
      new Error("Cannot confirm receipt before the seller ships the item"),
      { status: 409, code: "NOT_SHIPPED" },
    );
  }

  if (!txn.deliveredAt || status !== "DELIVERED") {
    if (!canTransition(status, "CONFIRM_RECEIPT")) {
      throw Object.assign(
        new Error(`Cannot start inspection from status ${status}`),
        { status: 409, code: "INVALID_TRANSITION" },
      );
    }
    const acked = await acknowledgeReceiptAfterShip({
      txn,
      buyerId: opts.buyerId,
    });
    txn = acked.transaction as TxnRow;
    status = txn.status as ProtectedStatus;
  }

  if (status === "IN_INSPECTION") {
    return {
      alreadyConfirmed: true,
      decision: "START_INSPECTION" as const,
      transferTriggered: false,
      transaction: txn,
    };
  }

  if (!canTransition(status, "START_INSPECTION")) {
    throw Object.assign(
      new Error(`Cannot start inspection from status ${status}`),
      { status: 409, code: "INVALID_TRANSITION" },
    );
  }

  const config = await getPlatformPaymentConfig();
  const inspectionEnds = new Date();
  inspectionEnds.setHours(inspectionEnds.getHours() + config.inspectionHours);

  const next = nextStatus(status, "START_INSPECTION");
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
    action: "START_INSPECTION",
    meta: {
      decision: "START_INSPECTION",
      inspectionEndsAt: inspectionEnds.toISOString(),
      inspectionHours: config.inspectionHours,
      transferTriggered: false,
    },
  });

  return {
    alreadyConfirmed: false,
    decision: "START_INSPECTION" as const,
    transferTriggered: false,
    transaction: updated,
  };
}

async function releaseNowAfterReceipt(opts: {
  txn: TxnRow;
  buyerId: string;
}) {
  // Lazy import avoids circular deps if release ever pulls fulfilment labels.
  const { releaseFinal } = await import("@/lib/payments/release");

  let txn = opts.txn;
  let status = txn.status as ProtectedStatus;

  if (status === "RELEASED" || txn.releasedAt) {
    return {
      alreadyConfirmed: true,
      decision: "RELEASE_NOW" as const,
      transferTriggered: false,
      alreadyReleased: true,
      transaction: txn,
    };
  }

  if (status === "DISPUTED") {
    throw Object.assign(
      new Error("Cannot release funds while an issue is open"),
      { status: 409, code: "DISPUTED" },
    );
  }

  const shipped = Boolean(txn.shippedAt || txn.trackingNumber);
  if (
    !shipped &&
    status !== "IN_INSPECTION" &&
    status !== "READY_TO_RELEASE"
  ) {
    throw Object.assign(
      new Error("Cannot release funds before the seller ships the item"),
      { status: 409, code: "NOT_SHIPPED" },
    );
  }

  if (
    !txn.deliveredAt &&
    status !== "IN_INSPECTION" &&
    status !== "READY_TO_RELEASE"
  ) {
    throw Object.assign(
      new Error("Confirm item received before releasing funds"),
      { status: 409, code: "RECEIPT_NOT_CONFIRMED" },
    );
  }

  if (status !== "READY_TO_RELEASE") {
    if (!canTransition(status, "BUYER_RELEASE_NOW")) {
      throw Object.assign(
        new Error(`Cannot release funds from status ${status}`),
        { status: 409, code: "INVALID_TRANSITION" },
      );
    }
    const next = nextStatus(status, "BUYER_RELEASE_NOW");
    txn = await prisma.protectedTransaction.update({
      where: { id: txn.id },
      data: {
        status: next,
        deliveredAt: txn.deliveredAt ?? new Date(),
        // Early release cancels any open inspection timer (cron no longer needed).
        inspectionEndsAt: null,
      },
    });
    status = next;
    await recordAuditEvent({
      protectedTxnId: txn.id,
      actorUserId: opts.buyerId,
      action: "BUYER_RELEASE_NOW",
      meta: { decision: "RELEASE_NOW", statusBeforeReleaseFinal: status },
    });
  }

  const result = await releaseFinal({
    protectedTxnId: txn.id,
    actorUserId: opts.buyerId,
  });

  return {
    alreadyConfirmed: Boolean(result.alreadyReleased),
    decision: "RELEASE_NOW" as const,
    transferTriggered: !result.alreadyReleased,
    alreadyReleased: Boolean(result.alreadyReleased),
    transferId: result.transferId ?? null,
    transaction: result.txn,
  };
}

async function reportIssueAfterReceipt(opts: {
  txn: TxnRow & {
    itemCostMinor?: number;
    shippingMinor?: number;
    sellerServiceFeeMinor?: number;
    protectionFeeMinor?: number;
    totalChargeMinor?: number;
    procurementAdvanceAgreed?: boolean;
    procurementAdvanceMinor?: number;
    procurementTransferredMinor?: number;
    finalTransferredMinor?: number;
    refundedMinor?: number;
    currency?: string;
  };
  buyerId: string;
  reason?: string;
  category?: string;
  details?: string;
}) {
  const txn = opts.txn;
  const status = txn.status as ProtectedStatus;
  const reason = (opts.reason || "").trim();
  const category = (opts.category || reason).trim();

  if (status === "DISPUTED") {
    const existing = await prisma.disputeCase.findFirst({
      where: { protectedTxnId: txn.id, status: "OPEN" },
      orderBy: { createdAt: "desc" },
    });
    return {
      alreadyConfirmed: true,
      decision: "REPORT_ISSUE" as const,
      transferTriggered: false,
      transaction: txn,
      dispute: existing,
    };
  }

  if (status === "RELEASED") {
    throw Object.assign(
      new Error("Cannot report an issue after residual funds are released"),
      { status: 409, code: "ALREADY_RELEASED" },
    );
  }

  // Sourcing: Report a Problem only during inspection.
  // Product Purchase: buyer may report without inspection authority.
  if (
    status !== "IN_INSPECTION" &&
    txn.origin !== "PRODUCT_CHECKOUT"
  ) {
    throw Object.assign(
      new Error(
        "Report a Problem is only available during the 12-hour inspection period",
      ),
      { status: 409, code: "ISSUE_INSPECTION_ONLY" },
    );
  }
  if (
    txn.origin === "PRODUCT_CHECKOUT" &&
    ![
      "FUNDED",
      "PROCUREMENT_RELEASED",
      "AWAITING_SHIPMENT",
      "IN_TRANSIT",
      "DELIVERED",
      "IN_INSPECTION",
    ].includes(status)
  ) {
    throw Object.assign(
      new Error(`Cannot report an issue from status ${status}`),
      { status: 409, code: "INVALID_TRANSITION" },
    );
  }

  if (!reason || reason.length < 3) {
    throw Object.assign(new Error("Please describe the issue (min 3 characters)"), {
      status: 400,
      code: "REASON_REQUIRED",
    });
  }

  if (
    status === "IN_INSPECTION" &&
    !canTransition(status, "OPEN_DISPUTE")
  ) {
    throw Object.assign(
      new Error(`Cannot report an issue from status ${status}`),
      { status: 409, code: "INVALID_TRANSITION" },
    );
  }

  const books = computeProtectedFinancials({
    itemCostMinor: txn.itemCostMinor ?? 0,
    shippingMinor: txn.shippingMinor ?? 0,
    sellerServiceFeeMinor: txn.sellerServiceFeeMinor ?? 0,
    protectionFeeMinor: txn.protectionFeeMinor ?? 0,
    totalChargeMinor: txn.totalChargeMinor,
    procurementAdvanceAgreed: txn.procurementAdvanceAgreed,
    procurementAdvanceMinor: txn.procurementAdvanceMinor,
    procurementTransferredMinor: txn.procurementTransferredMinor,
    finalTransferredMinor: txn.finalTransferredMinor,
    refundedMinor: txn.refundedMinor,
  });

  if (books.finalResidualMinor <= 0) {
    throw Object.assign(
      new Error("No remaining protected residual to place on issue hold"),
      { status: 409, code: "NO_RESIDUAL" },
    );
  }

  const financialSnapshot = {
    grossFundedMinor: books.grossFundedMinor,
    sellerEntitledMinor: books.sellerEntitledMinor,
    platformFeeMinor: books.platformFeeMinor,
    procurementTransferredMinor: books.procurementTransferredMinor,
    finalTransferredMinor: books.finalTransferredMinor,
    finalResidualMinor: books.finalResidualMinor,
    protectedRemainingMinor: books.protectedRemainingMinor,
    refundableMinor: books.refundableMinor,
    remainingProtectedSellerShareMinor: books.remainingProtectedSellerShareMinor,
  };

  const { dispute, updated } = await prisma.$transaction(async (tx) => {
    const d = await tx.disputeCase.create({
      data: {
        protectedTxnId: txn.id,
        openedById: opts.buyerId,
        category: category.slice(0, 120),
        reason: reason.slice(0, 200),
        details: (opts.details || "").slice(0, 4000),
        status: "UNDER_REVIEW",
      },
    });
    const u = await tx.protectedTransaction.update({
      where: { id: txn.id },
      data: {
        status: nextStatus(status, "OPEN_DISPUTE"),
        deliveredAt: txn.deliveredAt ?? new Date(),
        // Freeze scheduled auto-release; cron only processes IN_INSPECTION / READY.
        inspectionEndsAt: null,
      },
    });
    return { dispute: d, updated: u };
  });

  const { appendLedgerEntry } = await import("@/lib/payments/ledger");
  await appendLedgerEntry({
    protectedTxnId: txn.id,
    entryType: "DISPUTE_HOLD",
    direction: "DEBIT",
    amountMinor: books.finalResidualMinor,
    currency: (txn.currency || "GBP").toUpperCase(),
    idempotencyKey: `dispute_hold_${dispute.id}`,
    meta: { decision: "REPORT_ISSUE", financialSnapshot },
  });

  await recordAuditEvent({
    protectedTxnId: txn.id,
    actorUserId: opts.buyerId,
    action: "OPEN_DISPUTE",
    reason,
    meta: {
      decision: "REPORT_ISSUE",
      disputeId: dispute.id,
      category,
      transferTriggered: false,
      autoReleaseFrozen: true,
      underReviewImmediately: true,
      financialSnapshot,
    },
  });

  if (txn.conversationId) {
    try {
      const { bumpConversationActivity } = await import(
        "@/lib/conversation-activity"
      );
      await bumpConversationActivity(txn.conversationId, prisma, {
        touchLastMessage: true,
      });
    } catch (err) {
      console.error("[fulfilment:bump-activity-on-dispute]", err);
    }
  }

  try {
    const { notifyDisputeOpened } = await import("@/lib/payment-notifications");
    await notifyDisputeOpened({
      disputeId: dispute.id,
      protectedTxnId: txn.id,
      conversationId: txn.conversationId || "",
      buyerId: txn.buyerId,
      sellerId: txn.sellerId,
      category,
      openedById: opts.buyerId,
    });
  } catch (err) {
    console.error("[fulfilment:notify-dispute]", err);
  }

  return {
    alreadyConfirmed: false,
    decision: "REPORT_ISSUE" as const,
    transferTriggered: false,
    transaction: updated,
    dispute,
    financialSnapshot,
  };
}
