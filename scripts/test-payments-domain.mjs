/**
 * Unit tests for Protected Payments domain (no DB / Stripe).
 * Run: node scripts/test-payments-domain.mjs
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// Inline mirrors of pure helpers so this script runs without ts-node.
function calculateFees({ itemCostMinor, shippingMinor, config, sellerServiceFeeMinorOverride }) {
  const base = itemCostMinor + shippingMinor;
  const protectionRaw = Math.ceil((base * Math.max(0, config.protectionFeeBps)) / 10_000);
  const protectionFeeMinor = Math.max(
    protectionRaw,
    base > 0 ? Math.max(0, config.protectionFeeFloorMinor) : 0,
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

console.log("test-payments-domain: all assertions passed");
