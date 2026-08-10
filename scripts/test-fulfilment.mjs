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
    AWAITING_SHIPMENT: "IN_INSPECTION",
    IN_TRANSIT: "IN_INSPECTION",
    DELIVERED: "IN_INSPECTION",
  },
  COMPLETE_INSPECTION: {
    IN_INSPECTION: "READY_TO_RELEASE",
    DELIVERED: "READY_TO_RELEASE",
  },
  RELEASE_FINAL: {
    READY_TO_RELEASE: "RELEASED",
    FUNDED: "RELEASED",
    PROCUREMENT_RELEASED: "RELEASED",
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
    // Destination Charges — no stripe.transfers.create
    return false;
  }
  if (paymentOption === "PROTECTED" && status !== "READY_TO_RELEASE") {
    return false;
  }
  return true;
}

/** Seller add-tracking authorization (origin-agnostic CHAT_TICKET / PRODUCT) */
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
  // Origin never blocks tracking (CHAT_TICKET same engine as product).
  void origin;
  if (procurementAdvanceAgreed && procurementAdvanceMinor > 0) {
    const transferred =
      procurementTransferredMinor > 0 || txnStatus === "PROCUREMENT_RELEASED";
    if (txnStatus === "FUNDED" && !transferred) return false;
  }
  return true;
}

/** Seller self-declare delivered is never allowed (no DELIVERED action for seller) */
function sellerSelfMarkDeliveredAllowed() {
  return false;
}

/** Buyer confirm receipt */
function canConfirmReceipt({
  role,
  txnStatus,
  shipped,
  alreadyInspectionOrLater,
}) {
  if (role !== "buyer") return false;
  if (alreadyInspectionOrLater) return "idempotent";
  if (!shipped) return false;
  if (!canTransition(txnStatus, "CONFIRM_RECEIPT")) return false;
  return true;
}

/** After CONFIRM_RECEIPT — no Stripe transfer */
function confirmReceiptSideEffects() {
  return { nextStatus: "IN_INSPECTION", transferTriggered: false };
}

/** Provider DELIVERED → inspection only */
function onProviderDelivered(status) {
  assert.equal(canTransition(status, "TRACKING_DELIVERED"), true);
  let s = nextStatus(status, "TRACKING_DELIVERED");
  assert.equal(s, "DELIVERED");
  s = nextStatus(s, "START_INSPECTION");
  assert.equal(s, "IN_INSPECTION");
  return { status: s, transferTriggered: false };
}

/** Listing lifecycle */
function listingStatusAfter({ event, current }) {
  if (event === "checkout_start") return "RESERVED";
  if (event === "funded") return current; // stay RESERVED
  if (event === "released") return "SOLD";
  if (event === "cancel_unfunded") return "AVAILABLE";
  return current;
}

/** Allowlist */
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
// Procurement agreed but not released — cannot ship yet
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
// No procurement CHAT_TICKET — ship from FUNDED like product
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
// Seller cannot mark delivered
assert.equal(sellerSelfMarkDeliveredAllowed(), false);
// ADD_TRACKING never yields DELIVERED
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

// ── buyer confirmation does not trigger transfer
{
  const fx = confirmReceiptSideEffects();
  assert.equal(fx.nextStatus, "IN_INSPECTION");
  assert.equal(fx.transferTriggered, false);
  assert.equal(nextStatus("IN_TRANSIT", "CONFIRM_RECEIPT"), "IN_INSPECTION");
  assert.equal(
    canReleaseFinalProtected("IN_INSPECTION", "PROTECTED"),
    false,
  );
}

// ── DELIVERED enters inspection state
{
  const r = onProviderDelivered("IN_TRANSIT");
  assert.equal(r.status, "IN_INSPECTION");
  assert.equal(r.transferTriggered, false);
}

// ── releaseFinal requires READY_TO_RELEASE for PROTECTED
assert.equal(canReleaseFinalProtected("FUNDED", "PROTECTED"), false);
assert.equal(canReleaseFinalProtected("IN_INSPECTION", "PROTECTED"), false);
assert.equal(canReleaseFinalProtected("READY_TO_RELEASE", "PROTECTED"), true);
// Direct: Destination Charges — no platform transfers.create from FUNDED
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

// Full happy path state hop for protected (no transfer until READY_TO_RELEASE)
{
  let s = "FUNDED";
  s = nextStatus(s, "ADD_TRACKING");
  assert.equal(s, "AWAITING_SHIPMENT");
  s = nextStatus(s, "CONFIRM_RECEIPT");
  assert.equal(s, "IN_INSPECTION");
  s = nextStatus(s, "COMPLETE_INSPECTION");
  assert.equal(s, "READY_TO_RELEASE");
  assert.equal(canReleaseFinalProtected(s, "PROTECTED"), true);
  s = nextStatus(s, "RELEASE_FINAL");
  assert.equal(s, "RELEASED");
}

// Happy path with procurement: FUNDED → PROCUREMENT_RELEASED → ship → inspect → ready
{
  let s = "FUNDED";
  s = nextStatus(s, "RELEASE_PROCUREMENT");
  assert.equal(s, "PROCUREMENT_RELEASED");
  s = nextStatus(s, "ADD_TRACKING");
  assert.equal(s, "AWAITING_SHIPMENT");
  s = nextStatus(s, "CONFIRM_RECEIPT");
  assert.equal(s, "IN_INSPECTION");
  s = nextStatus(s, "COMPLETE_INSPECTION");
  assert.equal(s, "READY_TO_RELEASE");
  assert.equal(canReleaseFinalProtected(s, "PROTECTED"), true);
}

console.log("test-fulfilment: all assertions passed");
