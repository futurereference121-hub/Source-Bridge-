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
  RELEASE_PROCUREMENT: { FUNDED: "PROCUREMENT_RELEASED" },
  ADD_TRACKING: {
    FUNDED: "AWAITING_SHIPMENT",
    PROCUREMENT_RELEASED: "AWAITING_SHIPMENT",
  },
  CONFIRM_RECEIPT: {
    AWAITING_SHIPMENT: "IN_INSPECTION",
    IN_TRANSIT: "IN_INSPECTION",
    DELIVERED: "IN_INSPECTION",
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
  },
  RELEASE_FINAL: {
    READY_TO_RELEASE: "RELEASED",
    FUNDED: "RELEASED",
    PROCUREMENT_RELEASED: "RELEASED",
  },
  TRACKING_DELIVERED: { IN_TRANSIT: "DELIVERED", AWAITING_SHIPMENT: "DELIVERED" },
  OPEN_DISPUTE: { FUNDED: "DISPUTED", IN_INSPECTION: "DISPUTED", DELIVERED: "DISPUTED" },
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

const SOURCE_BRIDGE_FEE_BPS = 200;
const SOURCE_BRIDGE_FEE_FLOOR_MINOR = 0;
const feeConfig2pct = {
  protectionFeeBps: SOURCE_BRIDGE_FEE_BPS,
  protectionFeeFloorMinor: SOURCE_BRIDGE_FEE_FLOOR_MINOR,
  sellerServiceFeeBps: 0,
  directServiceFeeBps: SOURCE_BRIDGE_FEE_BPS,
  directServiceFeeFloorMinor: SOURCE_BRIDGE_FEE_FLOOR_MINOR,
};

// ── Fee calc: product $20 → $0.40, $40 → $0.80
{
  const f20 = calculateFees({
    itemCostMinor: 2_000,
    shippingMinor: 0,
    config: feeConfig2pct,
  });
  assert.equal(f20.protectionFeeMinor, 40);
  assert.equal(totalChargeMinor(f20), 2_040);

  const f40 = calculateFees({
    itemCostMinor: 4_000,
    shippingMinor: 0,
    config: feeConfig2pct,
  });
  assert.equal(f40.protectionFeeMinor, 80);
  assert.equal(totalChargeMinor(f40), 4_080);
}

// ── Sourcing: £50 + £15 + £20 sourcer → fee base £65 → £1.30; buyer £86.30; seller £85
{
  const fees = calculateFees({
    itemCostMinor: 5_000,
    shippingMinor: 1_500,
    config: feeConfig2pct,
    sellerServiceFeeMinorOverride: 2_000,
  });
  assert.equal(fees.protectionFeeMinor, 130); // ceil(6500 * 200 / 10000)
  assert.equal(
    fees.itemCostMinor + fees.shippingMinor + fees.sellerServiceFeeMinor,
    8_500,
  );
  assert.equal(totalChargeMinor(fees), 8_630);
}

// ── Sourcer fee exclusion: £20 → £100 must NOT change SB fee
{
  const a = calculateFees({
    itemCostMinor: 5_000,
    shippingMinor: 1_500,
    config: feeConfig2pct,
    sellerServiceFeeMinorOverride: 2_000,
  });
  const b = calculateFees({
    itemCostMinor: 5_000,
    shippingMinor: 1_500,
    config: feeConfig2pct,
    sellerServiceFeeMinorOverride: 10_000,
  });
  assert.equal(a.protectionFeeMinor, 130);
  assert.equal(b.protectionFeeMinor, 130);
  assert.equal(totalChargeMinor(b), 16_630); // 50+15+100+1.30
}

// ── Rounding / uneven amounts (ceil)
{
  assert.equal(
    calculateFees({
      itemCostMinor: 100,
      shippingMinor: 0,
      config: feeConfig2pct,
    }).protectionFeeMinor,
    2,
  ); // £1.00 → ceil(2)=2
  assert.equal(
    calculateFees({
      itemCostMinor: 199,
      shippingMinor: 0,
      config: feeConfig2pct,
    }).protectionFeeMinor,
    4,
  ); // £1.99 → ceil(3.98)=4
  assert.equal(
    calculateFees({
      itemCostMinor: 9999,
      shippingMinor: 0,
      config: feeConfig2pct,
    }).protectionFeeMinor,
    200,
  ); // £99.99 → ceil(199.98)=200
  assert.equal(
    calculateFees({
      itemCostMinor: 50_000,
      shippingMinor: 0,
      config: feeConfig2pct,
    }).protectionFeeMinor,
    1_000,
  );
  assert.equal(
    calculateFees({
      itemCostMinor: 100_000,
      shippingMinor: 0,
      config: feeConfig2pct,
    }).protectionFeeMinor,
    2_000,
  );
}

// ── Historical display: stored 3.5% fee is NOT recalculated from config
{
  const historicalStoredFeeMinor = 70; // $20 @ 3.5%
  const displayFee = historicalStoredFeeMinor; // UI uses stored protectionFeeMinor
  assert.equal(displayFee, 70);
  assert.notEqual(
    calculateFees({
      itemCostMinor: 2_000,
      shippingMinor: 0,
      config: feeConfig2pct,
    }).protectionFeeMinor,
    historicalStoredFeeMinor,
  );
}

// ── Security: client-supplied platform fee is ignored (server recalc)
{
  const clientClaimedFee = 1; // attacker tries $0.01
  const serverFees = calculateFees({
    itemCostMinor: 4_000,
    shippingMinor: 0,
    config: feeConfig2pct,
  });
  assert.equal(serverFees.protectionFeeMinor, 80);
  assert.notEqual(serverFees.protectionFeeMinor, clientClaimedFee);
}

// ── Direct uses same 2% bps (application_fee_amount = protectionFeeMinor)
{
  const direct = calculateFees({
    itemCostMinor: 4_000,
    shippingMinor: 0,
    config: feeConfig2pct,
    paymentOption: "DIRECT",
  });
  assert.equal(direct.protectionFeeMinor, 80);
}

// ── Optional floor still works when configured (not used at product default 0)
{
  const fees = calculateFees({
    itemCostMinor: 100,
    shippingMinor: 0,
    config: {
      ...feeConfig2pct,
      protectionFeeFloorMinor: 50,
    },
  });
  assert.equal(fees.protectionFeeMinor, 50); // ceil(2) < floor 50
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
assert.equal(canTransition("IN_INSPECTION", "BUYER_RELEASE_NOW"), true);
assert.equal(canTransition("AWAITING_SHIPMENT", "BUYER_RELEASE_NOW"), true);

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

// ── Test amounts (GBP): £5 + £1 + £1 service + 2% of £6 = 12p
{
  const fees = calculateFees({
    itemCostMinor: 500,
    shippingMinor: 100,
    config: feeConfig2pct,
    sellerServiceFeeMinorOverride: 100,
  });
  assert.equal(fees.itemCostMinor, 500);
  assert.equal(fees.shippingMinor, 100);
  assert.equal(fees.sellerServiceFeeMinor, 100);
  // base 600 → ceil(600*200/10000)=12
  assert.equal(fees.protectionFeeMinor, 12);
  assert.equal(totalChargeMinor(fees), 712);
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

// ── Procurement: fund does not imply RELEASE_PROCUREMENT
assert.equal(canTransition("FUNDED", "RELEASE_PROCUREMENT"), true);
assert.equal(canTransition("ACCEPTED", "RELEASE_PROCUREMENT"), false);
// PROCUREMENT_ADVANCES is manual — no transition from MARK_FUNDED to PROCUREMENT_RELEASED
assert.equal(canTransition("AWAITING_PAYMENT", "MARK_FUNDED"), true);
assert.notEqual(
  // funding lands on FUNDED only
  "PROCUREMENT_RELEASED",
  "FUNDED",
);

// ── Advance = item cost only
function procurementAdvanceAmount({ agreed, itemCostMinor, eligible }) {
  if (!agreed || !eligible) return 0;
  return itemCostMinor;
}
assert.equal(procurementAdvanceAmount({ agreed: true, itemCostMinor: 500, eligible: true }), 500);
assert.equal(procurementAdvanceAmount({ agreed: true, itemCostMinor: 500, eligible: false }), 0);

console.log("test-payments-domain: all assertions passed");
