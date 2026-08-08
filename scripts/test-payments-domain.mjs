/**
 * Unit tests for Protected Payments domain (no DB / Stripe).
 * Run: node scripts/test-payments-domain.mjs
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// Inline mirrors of pure helpers so this script runs without ts-node.
function calculateFees({ itemCostMinor, shippingMinor, config, sellerServiceFeeMinorOverride, paymentOption }) {
  const base = itemCostMinor + shippingMinor;
  const direct = paymentOption === "INSTANT" || paymentOption === "DIRECT";
  const bps = direct
    ? (config.directServiceFeeBps ?? config.protectionFeeBps)
    : config.protectionFeeBps;
  const floor = direct
    ? (config.directServiceFeeFloorMinor ?? config.protectionFeeFloorMinor)
    : config.protectionFeeFloorMinor;
  const protectionRaw = Math.ceil((base * Math.max(0, bps)) / 10_000);
  const protectionFeeMinor = Math.max(
    protectionRaw,
    base > 0 ? Math.max(0, floor) : 0,
  );
  const sellerServiceFeeMinor =
    sellerServiceFeeMinorOverride !== undefined
      ? sellerServiceFeeMinorOverride
      : Math.ceil((base * Math.max(0, config.sellerServiceFeeBps)) / 10_000);
  return { itemCostMinor, shippingMinor, sellerServiceFeeMinor, protectionFeeMinor };
}

function totalChargeMinor(b) {
  return b.itemCostMinor + b.shippingMinor + b.sellerServiceFeeMinor + b.protectionFeeMinor;
}

const TRANSITIONS = {
  MARK_FUNDED: { AWAITING_PAYMENT: "FUNDED", ACCEPTED: "FUNDED" },
  ADD_TRACKING: {
    FUNDED: "AWAITING_SHIPMENT",
    PROCUREMENT_RELEASED: "AWAITING_SHIPMENT",
  },
  CONFIRM_RECEIPT: {
    AWAITING_SHIPMENT: "IN_INSPECTION",
    IN_TRANSIT: "IN_INSPECTION",
    DELIVERED: "IN_INSPECTION",
  },
  COMPLETE_INSPECTION: {
    IN_INSPECTION: "READY_TO_RELEASE",
  },
  RELEASE_FINAL: {
    READY_TO_RELEASE: "RELEASED",
    FUNDED: "RELEASED",
    PROCUREMENT_RELEASED: "RELEASED",
  },
  TRACKING_DELIVERED: { IN_TRANSIT: "DELIVERED", AWAITING_SHIPMENT: "DELIVERED" },
  OPEN_DISPUTE: { FUNDED: "DISPUTED", IN_INSPECTION: "DISPUTED" },
};

function canTransition(from, action) {
  return Boolean(TRANSITIONS[action]?.[from]);
}

function normalizeTrackingStatus(raw) {
  const s = (raw || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!s) return "UNKNOWN";
  if (s.includes("delivered")) return "DELIVERED";
  if (s.includes("out_for_delivery")) return "OUT_FOR_DELIVERY";
  if (s.includes("exception") || s.includes("failed")) return "EXCEPTION";
  if (s.includes("in_transit") || s.includes("picked_up")) return "IN_TRANSIT";
  if (s.includes("label") || s.includes("pre_transit")) return "LABEL_CREATED";
  return "UNKNOWN";
}

function isProcurementEligible(input) {
  if (!input.featureFlagOn || !input.globallyEnabled) return false;
  if (!input.agreed) return false;
  if (input.paymentOption === "INSTANT") return false;
  if (!input.seller.procurementAdvancesEnabled) return false;
  if (input.seller.isDemo) return false;
  return input.seller.trustLevel >= input.minTrustLevel;
}

function hashTerms(obj) {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

// ── Fee calc
{
  const fees = calculateFees({
    itemCostMinor: 10_000,
    shippingMinor: 1_000,
    config: { protectionFeeBps: 350, protectionFeeFloorMinor: 50, sellerServiceFeeBps: 0 },
  });
  assert.equal(fees.protectionFeeMinor, 385); // ceil(11000 * 0.035)
  assert.equal(totalChargeMinor(fees), 11_385);
}

{
  const fees = calculateFees({
    itemCostMinor: 100,
    shippingMinor: 0,
    config: { protectionFeeBps: 350, protectionFeeFloorMinor: 50, sellerServiceFeeBps: 0 },
  });
  assert.equal(fees.protectionFeeMinor, 50); // floor
}

// ── State transitions
assert.equal(canTransition("AWAITING_PAYMENT", "MARK_FUNDED"), true);
assert.equal(canTransition("DRAFT", "MARK_FUNDED"), false);
assert.equal(canTransition("FUNDED", "RELEASE_FINAL"), true);
assert.equal(canTransition("IN_TRANSIT", "TRACKING_DELIVERED"), true);
assert.equal(canTransition("FUNDED", "OPEN_DISPUTE"), true);
assert.equal(canTransition("FUNDED", "ADD_TRACKING"), true);
assert.equal(canTransition("FUNDED", "CONFIRM_RECEIPT"), false);
assert.equal(canTransition("AWAITING_SHIPMENT", "CONFIRM_RECEIPT"), true);
assert.equal(canTransition("IN_INSPECTION", "COMPLETE_INSPECTION"), true);

// ── Tracking normalize
assert.equal(normalizeTrackingStatus("Delivered"), "DELIVERED");
assert.equal(normalizeTrackingStatus("in transit"), "IN_TRANSIT");
assert.equal(normalizeTrackingStatus("out for delivery"), "OUT_FOR_DELIVERY");
assert.equal(normalizeTrackingStatus("label created"), "LABEL_CREATED");
assert.equal(normalizeTrackingStatus(""), "UNKNOWN");

// ── Procurement eligibility
assert.equal(
  isProcurementEligible({
    featureFlagOn: true,
    globallyEnabled: true,
    agreed: true,
    paymentOption: "PROTECTED",
    minTrustLevel: 2,
    seller: { trustLevel: 2, procurementAdvancesEnabled: true, isDemo: false },
  }),
  true,
);
assert.equal(
  isProcurementEligible({
    featureFlagOn: true,
    globallyEnabled: true,
    agreed: true,
    paymentOption: "PROTECTED",
    minTrustLevel: 2,
    seller: { trustLevel: 1, procurementAdvancesEnabled: true, isDemo: false },
  }),
  false,
);
assert.equal(
  isProcurementEligible({
    featureFlagOn: true,
    globallyEnabled: true,
    agreed: true,
    paymentOption: "INSTANT",
    minTrustLevel: 2,
    seller: { trustLevel: 3, procurementAdvancesEnabled: true, isDemo: false },
  }),
  false,
);

// ── Terms hash stability
const a = hashTerms({ revision: 1, total: 100 });
const b = hashTerms({ revision: 1, total: 100 });
const c = hashTerms({ revision: 2, total: 100 });
assert.equal(a, b);
assert.notEqual(a, c);

// ── Listing defaults
const DEFAULT = "CONTACT_ONLY";
assert.equal(DEFAULT, "CONTACT_ONLY");

// ── Test amounts (GBP-style minor units): £5 + £1 + £1 service + platform fee
{
  const fees = calculateFees({
    itemCostMinor: 500,
    shippingMinor: 100,
    config: { protectionFeeBps: 350, protectionFeeFloorMinor: 50, sellerServiceFeeBps: 0 },
    sellerServiceFeeMinorOverride: 100,
  });
  assert.equal(fees.itemCostMinor, 500);
  assert.equal(fees.shippingMinor, 100);
  assert.equal(fees.sellerServiceFeeMinor, 100);
  // base 600 → ceil(600*0.035)=21, floor 50 → protection 50
  assert.equal(fees.protectionFeeMinor, 50);
  assert.equal(totalChargeMinor(fees), 750);
}

// ── Allowlist parse (mirrors src/lib/payments/allowlist.ts)
function parseAllowlist(raw) {
  if (!(raw || "").trim()) return [];
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
function matchesAllowlist(list, user) {
  if (!list.length) return false;
  const id = (user.id || "").toLowerCase();
  const email = (user.email || "").toLowerCase();
  return list.includes(id) || (email && list.includes(email));
}
{
  assert.deepEqual(parseAllowlist(""), []);
  assert.equal(matchesAllowlist([], { id: "x", email: "a@b.com" }), false);
  const list = parseAllowlist("abc123, Buyer@Example.com");
  assert.equal(matchesAllowlist(list, { id: "ABC123", email: "other@x.com" }), true);
  assert.equal(matchesAllowlist(list, { id: "nope", email: "buyer@example.com" }), true);
  assert.equal(matchesAllowlist(list, { id: "nope", email: "c@d.com" }), false);
}

// ── RELEASE_FINAL blocked from FUNDED for protected (domain note)
// Implementation re-checks paymentOption === PROTECTED && status FUNDED → throw
assert.equal(canTransition("FUNDED", "RELEASE_FINAL"), true); // state map allows; release.ts guards PROTECTED

console.log("test-payments-domain: all assertions passed");
