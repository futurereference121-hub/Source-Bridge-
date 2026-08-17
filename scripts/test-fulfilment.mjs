/**
 * Protected Payment fulfilment / release lifecycle unit tests (no DB / Stripe).
 * Run: node scripts/test-fulfilment.mjs
 */

import assert from "node:assert/strict";

/** Mirrors src/lib/payments/state-machine.ts (subset) */
const TRANSITIONS = {
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
  CONFIRM_RECEIPT: {
    AWAITING_SHIPMENT: "DELIVERED",
    IN_TRANSIT: "DELIVERED",
    DELIVERED: "DELIVERED",
  },
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
    READY_TO_RELEASE: "RELEASED",
    PARTIALLY_REFUNDED: "RELEASED",
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
};

function canTransition(from, action) {
  return Boolean(TRANSITIONS[action]?.[from]);
}

function nextStatus(from, action) {
  const next = TRANSITIONS[action]?.[from];
  if (!next) throw new Error(`Invalid: ${action} from ${from}`);
  return next;
}

/** releaseFinal money path — PROTECTED only after READY_TO_RELEASE; Direct never uses platform transfer */
function canReleaseFinalProtected(status, paymentOption) {
  if (!canTransition(status, "RELEASE_FINAL")) return false;
  if (paymentOption === "INSTANT" || paymentOption === "DIRECT") {
    return false;
  }
  if (
    paymentOption === "PROTECTED" &&
    status !== "READY_TO_RELEASE" &&
    status !== "PARTIALLY_REFUNDED"
  ) {
    return false;
  }
  return true;
}

function canAddTracking({
  role,
  txnStatus,
  trackingNumber,
  paymentOption = "PROTECTED",
  origin = "PRODUCT_CHECKOUT",
  procurementAdvanceAgreed = false,
  procurementAdvanceMinor = 0,
  procurementTransferredMinor = 0,
}) {
  if (role !== "seller") return false;
  if (paymentOption === "INSTANT" || paymentOption === "DIRECT") return false;
  if (trackingNumber) return false;
  if (["RELEASED", "REFUNDED", "PARTIALLY_REFUNDED", "CANCELLED", "DISPUTED"].includes(txnStatus)) {
    return false;
  }
  if (!["FUNDED", "PROCUREMENT_RELEASED", "AWAITING_SHIPMENT"].includes(txnStatus)) {
    return false;
  }
  void origin;
  if (procurementAdvanceAgreed && procurementAdvanceMinor > 0) {
    const transferred =
      procurementTransferredMinor > 0 || txnStatus === "PROCUREMENT_RELEASED";
    if (txnStatus === "FUNDED" && !transferred) return false;
  }
  return true;
}

function sellerSelfMarkDeliveredAllowed() {
  return false;
}

function canConfirmReceipt({
  role,
  txnStatus,
  shipped,
  deliveredAt = null,
  alreadyInspectionOrLater,
}) {
  if (role !== "buyer") return false;
  if (alreadyInspectionOrLater) return "idempotent";
  if (!shipped) return false;
  if (deliveredAt) return false;
  if (!canTransition(txnStatus, "CONFIRM_RECEIPT")) return false;
  return true;
}

function canReleaseNow({ role, txnStatus, shipped, deliveredAt = null }) {
  if (role !== "buyer") return false;
  if (txnStatus === "IN_INSPECTION" || txnStatus === "READY_TO_RELEASE") return true;
  if (!shipped) return false;
  if (!deliveredAt) return false;
  return txnStatus === "DELIVERED";
}

/** Report a Problem only during IN_INSPECTION with residual remaining. */
function canReportIssue({ role, txnStatus, residualMinor = 1 }) {
  if (role !== "buyer") return false;
  if (txnStatus !== "IN_INSPECTION") return false;
  if (residualMinor <= 0) return false;
  return canTransition(txnStatus, "OPEN_DISPUTE");
}

/** After ship: Confirm Item Received only. After ACK: Release + Inspect. */
function postShipBuyerChoices({ shipped, deliveredAt, txnStatus }) {
  if (!shipped || deliveredAt) return [];
  if (!["AWAITING_SHIPMENT", "IN_TRANSIT", "DELIVERED"].includes(txnStatus)) {
    return [];
  }
  return ["CONFIRM_RECEIPT"];
}

function postReceiptBuyerChoices({ deliveredAt, txnStatus }) {
  if (!deliveredAt || txnStatus !== "DELIVERED") return [];
  return ["RELEASE_NOW", "START_INSPECTION"];
}

/** Initial receipt modal — only two choices (Report reserved for inspection). */
function initialReceiptChoices() {
  return ["RELEASE_NOW", "START_INSPECTION"];
}

function startInspectionSideEffects() {
  return { nextStatus: "IN_INSPECTION", transferTriggered: false };
}

function releaseNowSideEffects(status) {
  assert.equal(canTransition(status, "BUYER_RELEASE_NOW"), true);
  const ready = nextStatus(status, "BUYER_RELEASE_NOW");
  assert.equal(ready, "READY_TO_RELEASE");
  return {
    nextStatus: ready,
    transferPath: "releaseFinal",
    residualOnly: true,
  };
}

function reportIssueSideEffects(status) {
  assert.equal(status, "IN_INSPECTION");
  assert.equal(canTransition(status, "OPEN_DISPUTE"), true);
  const s = nextStatus(status, "OPEN_DISPUTE");
  assert.equal(s, "DISPUTED");
  return {
    nextStatus: s,
    transferTriggered: false,
    cronSkips: true,
  };
}

function cronWouldRelease({ status, inspectionEndsAt, now, openIssue = false, released = false }) {
  if (released) return false;
  if (status === "DISPUTED") return false;
  if (openIssue) return false;
  if (status === "IN_INSPECTION" && inspectionEndsAt && inspectionEndsAt <= now) {
    return true;
  }
  if (status === "READY_TO_RELEASE") return true;
  return false;
}

function finalResidualMinor({
  sellerEntitledMinor,
  procurementTransferredMinor,
  finalTransferredMinor,
  platformFeeMinor = 0,
  grossFundedMinor,
  refundedMinor = 0,
}) {
  const transferred = procurementTransferredMinor + finalTransferredMinor;
  const protectedRemaining = Math.max(
    0,
    (grossFundedMinor ?? sellerEntitledMinor + platformFeeMinor) -
      transferred -
      refundedMinor,
  );
  const sellerShareOutstanding = Math.max(
    0,
    sellerEntitledMinor - transferred,
  );
  const feeStillOnPlatform = Math.min(platformFeeMinor, protectedRemaining);
  const platformSellerCash = Math.max(0, protectedRemaining - feeStillOnPlatform);
  return Math.min(sellerShareOutstanding, platformSellerCash);
}

/** Admin refund bounds — never exceed platform remainder. */
function adminRefundBound({ requestedMinor, refundableMinor }) {
  if (requestedMinor > refundableMinor) {
    return { ok: false, code: "REFUND_EXCEEDS_PLATFORM", amount: 0 };
  }
  const amount = Math.min(Math.max(0, requestedMinor), refundableMinor);
  return { ok: amount > 0, amount, code: amount > 0 ? null : "NOTHING_REFUNDABLE" };
}

function adminSellerReleaseFromDispute(status) {
  assert.equal(status, "DISPUTED");
  const ready = nextStatus(status, "RESOLVE_DISPUTE");
  assert.equal(ready, "READY_TO_RELEASE");
  assert.equal(canReleaseFinalProtected(ready, "PROTECTED"), true);
  return ready;
}

const DEFAULT_INSPECTION_HOURS = 12;

function onProviderDelivered(status) {
  assert.equal(canTransition(status, "TRACKING_DELIVERED"), true);
  const s = nextStatus(status, "TRACKING_DELIVERED");
  assert.equal(s, "DELIVERED");
  return { status: s, transferTriggered: false, inspectionHours: null };
}

function listingStatusAfter({ event, current }) {
  if (event === "checkout_start") return "RESERVED";
  if (event === "funded") return current;
  if (event === "released") return "SOLD";
  if (event === "cancel_unfunded") return "AVAILABLE";
  return current;
}

function matchesAllowlist(list, user) {
  if (!list.length) return false;
  const id = (user.id || "").toLowerCase();
  const email = (user.email || "").toLowerCase();
  if (id && list.includes(id)) return true;
  if (email && list.includes(email)) return true;
  return false;
}

// ── only seller can add tracking
assert.equal(
  canAddTracking({ role: "seller", txnStatus: "FUNDED", trackingNumber: "" }),
  true,
);
assert.equal(
  canAddTracking({ role: "buyer", txnStatus: "FUNDED", trackingNumber: "" }),
  false,
);
assert.equal(canTransition("FUNDED", "ADD_TRACKING"), true);
assert.equal(nextStatus("FUNDED", "ADD_TRACKING"), "AWAITING_SHIPMENT");
assert.equal(
  canAddTracking({
    role: "seller",
    txnStatus: "PROCUREMENT_RELEASED",
    trackingNumber: "",
    origin: "CHAT_TICKET",
    procurementAdvanceAgreed: true,
    procurementAdvanceMinor: 5000,
    procurementTransferredMinor: 5000,
  }),
  true,
);
assert.equal(
  canAddTracking({
    role: "seller",
    txnStatus: "FUNDED",
    trackingNumber: "",
    origin: "CHAT_TICKET",
    procurementAdvanceAgreed: true,
    procurementAdvanceMinor: 5000,
    procurementTransferredMinor: 0,
  }),
  false,
);
assert.equal(
  canAddTracking({
    role: "seller",
    txnStatus: "FUNDED",
    trackingNumber: "",
    origin: "CHAT_TICKET",
    procurementAdvanceAgreed: false,
  }),
  true,
);
assert.equal(sellerSelfMarkDeliveredAllowed(), false);
assert.notEqual(nextStatus("FUNDED", "ADD_TRACKING"), "DELIVERED");

// ── only buyer can confirm receipt
assert.equal(
  canConfirmReceipt({
    role: "buyer",
    txnStatus: "AWAITING_SHIPMENT",
    shipped: true,
    alreadyInspectionOrLater: false,
  }),
  true,
);
assert.equal(
  canConfirmReceipt({
    role: "seller",
    txnStatus: "AWAITING_SHIPMENT",
    shipped: true,
    alreadyInspectionOrLater: false,
  }),
  false,
);

// ── receipt cannot be confirmed before shipment
assert.equal(
  canConfirmReceipt({
    role: "buyer",
    txnStatus: "FUNDED",
    shipped: false,
    alreadyInspectionOrLater: false,
  }),
  false,
);
assert.equal(canTransition("FUNDED", "CONFIRM_RECEIPT"), false);

// ── duplicate receipt confirmation is harmless (idempotent path)
assert.equal(
  canConfirmReceipt({
    role: "buyer",
    txnStatus: "IN_INSPECTION",
    shipped: true,
    alreadyInspectionOrLater: true,
  }),
  "idempotent",
);

// ── two-choice after receipt (Report removed)
{
  const choices = initialReceiptChoices();
  assert.deepEqual(choices, ["RELEASE_NOW", "START_INSPECTION"]);
  assert.equal(choices.includes("REPORT_ISSUE"), false);
  assert.equal(choices.length, 2);
  assert.deepEqual(
    postShipBuyerChoices({
      shipped: true,
      deliveredAt: null,
      txnStatus: "AWAITING_SHIPMENT",
    }),
    ["CONFIRM_RECEIPT"],
  );
  assert.deepEqual(
    postReceiptBuyerChoices({
      deliveredAt: null,
      txnStatus: "AWAITING_SHIPMENT",
    }),
    [],
  );
  assert.deepEqual(
    postReceiptBuyerChoices({
      deliveredAt: new Date(),
      txnStatus: "DELIVERED",
    }),
    ["RELEASE_NOW", "START_INSPECTION"],
  );
}

// ── START_INSPECTION — no Stripe transfer
{
  const fx = startInspectionSideEffects();
  assert.equal(fx.nextStatus, "IN_INSPECTION");
  assert.equal(fx.transferTriggered, false);
  assert.equal(nextStatus("IN_TRANSIT", "CONFIRM_RECEIPT"), "DELIVERED");
  assert.equal(nextStatus("DELIVERED", "START_INSPECTION"), "IN_INSPECTION");
  assert.equal(
    canReleaseFinalProtected("IN_INSPECTION", "PROTECTED"),
    false,
  );
}

// ── RELEASE_NOW residual via releaseFinal only
{
  const fx = releaseNowSideEffects("DELIVERED");
  assert.equal(fx.nextStatus, "READY_TO_RELEASE");
  assert.equal(fx.transferPath, "releaseFinal");
  assert.equal(fx.residualOnly, true);
  assert.equal(canReleaseFinalProtected(fx.nextStatus, "PROTECTED"), true);
  assert.equal(canReleaseNow({ role: "buyer", txnStatus: "IN_INSPECTION", shipped: true }), true);
  assert.equal(canReleaseNow({ role: "seller", txnStatus: "IN_INSPECTION", shipped: true }), false);
  assert.equal(
    canReleaseNow({
      role: "buyer",
      txnStatus: "AWAITING_SHIPMENT",
      shipped: true,
      deliveredAt: null,
    }),
    false,
  );
  assert.equal(
    canReleaseNow({
      role: "buyer",
      txnStatus: "DELIVERED",
      shipped: true,
      deliveredAt: new Date(),
    }),
    true,
  );
  assert.equal(nextStatus("IN_INSPECTION", "BUYER_RELEASE_NOW"), "READY_TO_RELEASE");
}

// ── issue only during inspection (not pre-decision states)
assert.equal(canReportIssue({ role: "buyer", txnStatus: "AWAITING_SHIPMENT" }), false);
assert.equal(canReportIssue({ role: "buyer", txnStatus: "DELIVERED" }), false);
assert.equal(canReportIssue({ role: "buyer", txnStatus: "FUNDED" }), false);
assert.equal(canReportIssue({ role: "buyer", txnStatus: "READY_TO_RELEASE" }), false);
assert.equal(canReportIssue({ role: "buyer", txnStatus: "IN_INSPECTION", residualMinor: 0 }), false);
assert.equal(canReportIssue({ role: "buyer", txnStatus: "IN_INSPECTION", residualMinor: 100 }), true);
assert.equal(canReportIssue({ role: "seller", txnStatus: "IN_INSPECTION" }), false);

// ── REPORT_ISSUE freezes cron
{
  const fx = reportIssueSideEffects("IN_INSPECTION");
  assert.equal(fx.nextStatus, "DISPUTED");
  assert.equal(fx.cronSkips, true);
  assert.equal(
    cronWouldRelease({
      status: "DISPUTED",
      inspectionEndsAt: new Date(0),
      now: new Date(),
    }),
    false,
  );
  assert.equal(
    cronWouldRelease({
      status: "IN_INSPECTION",
      inspectionEndsAt: new Date(0),
      now: new Date(),
      openIssue: true,
    }),
    false,
  );
  assert.equal(
    cronWouldRelease({
      status: "IN_INSPECTION",
      inspectionEndsAt: new Date(0),
      now: new Date(),
      openIssue: false,
    }),
    true,
  );
  assert.equal(canReportIssue({ role: "buyer", txnStatus: "IN_INSPECTION" }), true);
  assert.equal(canReportIssue({ role: "buyer", txnStatus: "RELEASED" }), false);
  assert.equal(canReportIssue({ role: "buyer", txnStatus: "RELEASED", residualMinor: 999 }), false);
}

// ── admin seller-release resolution path
assert.equal(adminSellerReleaseFromDispute("DISPUTED"), "READY_TO_RELEASE");

// ── admin refund bounds
{
  const over = adminRefundBound({ requestedMinor: 5000, refundableMinor: 2000 });
  assert.equal(over.ok, false);
  assert.equal(over.code, "REFUND_EXCEEDS_PLATFORM");
  const ok = adminRefundBound({ requestedMinor: 1500, refundableMinor: 2000 });
  assert.equal(ok.ok, true);
  assert.equal(ok.amount, 1500);
  const zero = adminRefundBound({ requestedMinor: 0, refundableMinor: 2000 });
  assert.equal(zero.ok, false);
}

// ── sourcing residual math (cmslox7aq style): proc 5000, entitled 8500, fee 500 → final 3500
{
  const residual = finalResidualMinor({
    sellerEntitledMinor: 8500,
    procurementTransferredMinor: 5000,
    finalTransferredMinor: 0,
    platformFeeMinor: 500,
    grossFundedMinor: 9000,
  });
  assert.equal(residual, 3500);
  // Never treat full charge as protected residual
  assert.notEqual(residual, 9000);
  assert.notEqual(residual, 8500);
  assert.notEqual(residual, 5000);
  // After partial buyer refund, residual shrinks by cash left
  const afterRefund = finalResidualMinor({
    sellerEntitledMinor: 8500,
    procurementTransferredMinor: 5000,
    finalTransferredMinor: 0,
    platformFeeMinor: 500,
    grossFundedMinor: 9000,
    refundedMinor: 1000,
  });
  assert.equal(afterRefund, 2500);
  // Fee never paid as residual when only fee remains
  const feeOnly = finalResidualMinor({
    sellerEntitledMinor: 8500,
    procurementTransferredMinor: 5000,
    finalTransferredMinor: 3500,
    platformFeeMinor: 500,
    grossFundedMinor: 9000,
    refundedMinor: 0,
  });
  assert.equal(feeOnly, 0);
}

// ── default inspection hours
assert.equal(DEFAULT_INSPECTION_HOURS, 12);

// ── Direct Payment regression: no buyer release-now decision money path
assert.equal(canReleaseFinalProtected("FUNDED", "DIRECT"), false);
assert.equal(canReleaseFinalProtected("READY_TO_RELEASE", "DIRECT"), false);
assert.equal(canReportIssue({ role: "buyer", txnStatus: "IN_INSPECTION" }), true);
// Direct gate is payment option level outside canReportIssue in product tests —
// direct never uses this inspection flow for money.
assert.equal(canReleaseFinalProtected("IN_INSPECTION", "DIRECT"), false);

// ── never re-open completed RELEASED (rubber / historical)
assert.equal(canTransition("RELEASED", "BUYER_RELEASE_NOW"), false);
assert.equal(canTransition("RELEASED", "RELEASE_FINAL"), false);
assert.equal(canTransition("RELEASED", "OPEN_DISPUTE"), false);
assert.equal(
  cronWouldRelease({
    status: "RELEASED",
    inspectionEndsAt: new Date(0),
    now: new Date(),
    released: true,
  }),
  false,
);

// ── idempotency
assert.equal(nextStatus("READY_TO_RELEASE", "BUYER_RELEASE_NOW"), "READY_TO_RELEASE");
assert.equal(canTransition("RELEASED", "BUYER_RELEASE_NOW"), false);

// ── DELIVERED enters inspection state
{
  const r = onProviderDelivered("IN_TRANSIT");
  assert.equal(r.status, "DELIVERED");
  assert.equal(r.transferTriggered, false);
  assert.equal(r.inspectionHours, null);
}

// ── releaseFinal requires READY_TO_RELEASE (or admin partial) for PROTECTED
assert.equal(canReleaseFinalProtected("FUNDED", "PROTECTED"), false);
assert.equal(canReleaseFinalProtected("IN_INSPECTION", "PROTECTED"), false);
assert.equal(canReleaseFinalProtected("READY_TO_RELEASE", "PROTECTED"), true);
assert.equal(canReleaseFinalProtected("PARTIALLY_REFUNDED", "PROTECTED"), true);
assert.equal(canReleaseFinalProtected("FUNDED", "INSTANT"), false);
assert.equal(canReleaseFinalProtected("FUNDED", "DIRECT"), false);

// ── listing stays RESERVED before final release; SOLD only after RELEASED
assert.equal(listingStatusAfter({ event: "checkout_start", current: "AVAILABLE" }), "RESERVED");
assert.equal(listingStatusAfter({ event: "funded", current: "RESERVED" }), "RESERVED");
assert.equal(listingStatusAfter({ event: "released", current: "RESERVED" }), "SOLD");
assert.equal(
  listingStatusAfter({ event: "cancel_unfunded", current: "RESERVED" }),
  "AVAILABLE",
);

// ── users outside allowlist remain blocked
{
  const list = ["cms8or23a0000la046qm6ene4", "cms62cfan0000ih04giwg7ee3"];
  assert.equal(matchesAllowlist(list, { id: "cms8or23a0000la046qm6ene4" }), true);
  assert.equal(matchesAllowlist(list, { id: "random-user" }), false);
  assert.equal(matchesAllowlist([], { id: "cms8or23a0000la046qm6ene4" }), false);
}

// Full happy path: START_INSPECTION then cron COMPLETE → releaseFinal
{
  let s = "FUNDED";
  s = nextStatus(s, "ADD_TRACKING");
  assert.equal(s, "AWAITING_SHIPMENT");
  s = nextStatus(s, "CONFIRM_RECEIPT");
  assert.equal(s, "DELIVERED");
  s = nextStatus(s, "START_INSPECTION");
  assert.equal(s, "IN_INSPECTION");
  s = nextStatus(s, "COMPLETE_INSPECTION");
  assert.equal(s, "READY_TO_RELEASE");
  assert.equal(canReleaseFinalProtected(s, "PROTECTED"), true);
  s = nextStatus(s, "RELEASE_FINAL");
  assert.equal(s, "RELEASED");
}

// Immediate RELEASE_NOW after buyer confirms receipt
{
  let s = "FUNDED";
  s = nextStatus(s, "ADD_TRACKING");
  s = nextStatus(s, "CONFIRM_RECEIPT");
  assert.equal(s, "DELIVERED");
  s = nextStatus(s, "BUYER_RELEASE_NOW");
  assert.equal(s, "READY_TO_RELEASE");
  s = nextStatus(s, "RELEASE_FINAL");
  assert.equal(s, "RELEASED");
}

// Happy path with procurement residual preserved
{
  let s = "FUNDED";
  s = nextStatus(s, "RELEASE_PROCUREMENT");
  assert.equal(s, "PROCUREMENT_RELEASED");
  s = nextStatus(s, "ADD_TRACKING");
  assert.equal(s, "AWAITING_SHIPMENT");
  s = nextStatus(s, "CONFIRM_RECEIPT");
  assert.equal(s, "DELIVERED");
  s = nextStatus(s, "BUYER_RELEASE_NOW");
  assert.equal(s, "READY_TO_RELEASE");
  assert.equal(canReleaseFinalProtected(s, "PROTECTED"), true);
  const residual = finalResidualMinor({
    sellerEntitledMinor: 8500,
    procurementTransferredMinor: 5000,
    finalTransferredMinor: 0,
    platformFeeMinor: 500,
    grossFundedMinor: 9000,
  });
  assert.equal(residual, 3500);
}

// Issue during inspection freezes then admin seller resolve
{
  let s = "FUNDED";
  s = nextStatus(s, "ADD_TRACKING");
  s = nextStatus(s, "CONFIRM_RECEIPT");
  assert.equal(s, "DELIVERED");
  s = nextStatus(s, "START_INSPECTION");
  assert.equal(s, "IN_INSPECTION");
  assert.equal(canReportIssue({ role: "buyer", txnStatus: s, residualMinor: 100 }), true);
  s = nextStatus(s, "OPEN_DISPUTE");
  assert.equal(s, "DISPUTED");
  assert.equal(cronWouldRelease({ status: s, inspectionEndsAt: new Date(0), now: new Date() }), false);
  s = adminSellerReleaseFromDispute(s);
  s = nextStatus(s, "RELEASE_FINAL");
  assert.equal(s, "RELEASED");
}

console.log("test-fulfilment: all assertions passed");
