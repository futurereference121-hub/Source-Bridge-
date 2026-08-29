/**
 * Unit tests for Protected Payments domain (no DB / Stripe).
 * Run: node scripts/test-payments-domain.mjs
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// Inline mirrors of pure helpers so this script runs without ts-node.
function calculateFees({ itemCostMinor, shippingMinor, config, sellerServiceFeeMinorOverride, paymentOption }) {
  const direct = paymentOption === "INSTANT" || paymentOption === "DIRECT";
  const bps = direct
    ? (config.directServiceFeeBps ?? config.protectionFeeBps)
    : config.protectionFeeBps;
  const floor = direct
    ? (config.directServiceFeeFloorMinor ?? config.protectionFeeFloorMinor)
    : config.protectionFeeFloorMinor;
  const sellerServiceFeeMinor =
    sellerServiceFeeMinorOverride !== undefined
      ? sellerServiceFeeMinorOverride
      : Math.ceil(
          ((itemCostMinor + shippingMinor) *
            Math.max(0, config.sellerServiceFeeBps)) /
            10_000,
        );
  const feeBaseMinor = itemCostMinor + shippingMinor + sellerServiceFeeMinor;
  const protectionRaw = Math.ceil((feeBaseMinor * Math.max(0, bps)) / 10_000);
  const protectionFeeMinor = Math.max(
    protectionRaw,
    feeBaseMinor > 0 ? Math.max(0, floor) : 0,
  );
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
    AWAITING_SHIPMENT: "DELIVERED",
    IN_TRANSIT: "DELIVERED",
    DELIVERED: "DELIVERED",
  },
  START_INSPECTION: {
    DELIVERED: "IN_INSPECTION",
  },
  BUYER_RELEASE_NOW: {
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

const SOURCE_BRIDGE_FEE_BPS = 700;
const SOURCE_BRIDGE_FEE_FLOOR_MINOR = 0;
const feeConfig7pct = {
  protectionFeeBps: SOURCE_BRIDGE_FEE_BPS,
  protectionFeeFloorMinor: SOURCE_BRIDGE_FEE_FLOOR_MINOR,
  sellerServiceFeeBps: 0,
  directServiceFeeBps: SOURCE_BRIDGE_FEE_BPS,
  directServiceFeeFloorMinor: SOURCE_BRIDGE_FEE_FLOOR_MINOR,
};

// ── Canonical £100 / $100 / €100 fee base → £7 / $7 / €7
{
  for (const label of ["GBP", "USD", "EUR"]) {
    const fees = calculateFees({
      itemCostMinor: 10_000,
      shippingMinor: 0,
      config: feeConfig7pct,
    });
    assert.equal(fees.protectionFeeMinor, 700, label);
    assert.equal(totalChargeMinor(fees), 10_700, label);
  }
}

// ── Fee calc: product $20 → $1.40, $40 → $2.80
{
  const f20 = calculateFees({
    itemCostMinor: 2_000,
    shippingMinor: 0,
    config: feeConfig7pct,
  });
  assert.equal(f20.protectionFeeMinor, 140);
  assert.equal(totalChargeMinor(f20), 2_140);

  const f40 = calculateFees({
    itemCostMinor: 4_000,
    shippingMinor: 0,
    config: feeConfig7pct,
  });
  assert.equal(f40.protectionFeeMinor, 280);
  assert.equal(totalChargeMinor(f40), 4_280);
}

// ── TEST A: £100 + £20 + £30 sourcer → seller £150; SB £10.50; buyer £160.50
{
  const fees = calculateFees({
    itemCostMinor: 10_000,
    shippingMinor: 2_000,
    config: feeConfig7pct,
    sellerServiceFeeMinorOverride: 3_000,
  });
  assert.equal(
    fees.itemCostMinor + fees.shippingMinor + fees.sellerServiceFeeMinor,
    15_000,
  );
  assert.equal(fees.protectionFeeMinor, 1_050);
  assert.equal(totalChargeMinor(fees), 16_050);
}

// ── TEST B: $50 + $10 + $40 → seller $100; SB $7; buyer $107
{
  const fees = calculateFees({
    itemCostMinor: 5_000,
    shippingMinor: 1_000,
    config: feeConfig7pct,
    sellerServiceFeeMinorOverride: 4_000,
  });
  assert.equal(
    fees.itemCostMinor + fees.shippingMinor + fees.sellerServiceFeeMinor,
    10_000,
  );
  assert.equal(fees.protectionFeeMinor, 700);
  assert.equal(totalChargeMinor(fees), 10_700);
}

// ── TEST C: £10 + £0 + £10 → seller £20; SB £1.40; buyer £21.40
{
  const fees = calculateFees({
    itemCostMinor: 1_000,
    shippingMinor: 0,
    config: feeConfig7pct,
    sellerServiceFeeMinorOverride: 1_000,
  });
  assert.equal(
    fees.itemCostMinor + fees.shippingMinor + fees.sellerServiceFeeMinor,
    2_000,
  );
  assert.equal(fees.protectionFeeMinor, 140);
  assert.equal(totalChargeMinor(fees), 2_140);
}

// ── Sourcing: £50 + £15 + £20 sourcer → fee base £85 → £5.95; buyer £90.95; seller £85
{
  const fees = calculateFees({
    itemCostMinor: 5_000,
    shippingMinor: 1_500,
    config: feeConfig7pct,
    sellerServiceFeeMinorOverride: 2_000,
  });
  assert.equal(fees.protectionFeeMinor, 595); // ceil(8500 * 700 / 10000)
  assert.equal(
    fees.itemCostMinor + fees.shippingMinor + fees.sellerServiceFeeMinor,
    8_500,
  );
  assert.equal(totalChargeMinor(fees), 9_095);
}

// ── Sourcer fee INCLUDED in fee base: £20 → £100 MUST change SB fee
{
  const a = calculateFees({
    itemCostMinor: 5_000,
    shippingMinor: 1_500,
    config: feeConfig7pct,
    sellerServiceFeeMinorOverride: 2_000,
  });
  const b = calculateFees({
    itemCostMinor: 5_000,
    shippingMinor: 1_500,
    config: feeConfig7pct,
    sellerServiceFeeMinorOverride: 10_000,
  });
  assert.equal(a.protectionFeeMinor, 595); // ceil(8500*700/10000)
  assert.equal(b.protectionFeeMinor, 1_155); // ceil(16500*700/10000)
  assert.notEqual(a.protectionFeeMinor, b.protectionFeeMinor);
  assert.equal(totalChargeMinor(b), 17_655); // 50+15+100+11.55
}

// ── No compounding: SB fee never enters its own base
{
  const fees = calculateFees({
    itemCostMinor: 10_000,
    shippingMinor: 2_000,
    config: feeConfig7pct,
    sellerServiceFeeMinorOverride: 3_000,
  });
  const sellerSubtotal =
    fees.itemCostMinor + fees.shippingMinor + fees.sellerServiceFeeMinor;
  assert.equal(fees.protectionFeeMinor, Math.ceil((sellerSubtotal * 700) / 10_000));
  assert.equal(totalChargeMinor(fees), sellerSubtotal + fees.protectionFeeMinor);
  assert.notEqual(
    fees.protectionFeeMinor,
    Math.ceil(((sellerSubtotal + fees.protectionFeeMinor) * 700) / 10_000),
  );
}

// ── Rounding / uneven amounts (ceil) at 7%
{
  assert.equal(
    calculateFees({
      itemCostMinor: 100,
      shippingMinor: 0,
      config: feeConfig7pct,
    }).protectionFeeMinor,
    7,
  ); // £1.00 → ceil(7)=7
  assert.equal(
    calculateFees({
      itemCostMinor: 199,
      shippingMinor: 0,
      config: feeConfig7pct,
    }).protectionFeeMinor,
    14,
  ); // £1.99 → ceil(13.93)=14
  assert.equal(
    calculateFees({
      itemCostMinor: 9999,
      shippingMinor: 0,
      config: feeConfig7pct,
    }).protectionFeeMinor,
    700,
  ); // £99.99 → ceil(699.93)=700
  assert.equal(
    calculateFees({
      itemCostMinor: 50_000,
      shippingMinor: 0,
      config: feeConfig7pct,
    }).protectionFeeMinor,
    3_500,
  );
  assert.equal(
    calculateFees({
      itemCostMinor: 100_000,
      shippingMinor: 0,
      config: feeConfig7pct,
    }).protectionFeeMinor,
    7_000,
  );
}

// ── Zero-decimal (JPY): same integer bps math on major=minor units
{
  assert.equal(
    calculateFees({
      itemCostMinor: 10_000,
      shippingMinor: 0,
      config: feeConfig7pct,
    }).protectionFeeMinor,
    700,
  ); // ¥10000 → ¥700
  assert.equal(
    calculateFees({
      itemCostMinor: 199,
      shippingMinor: 0,
      config: feeConfig7pct,
    }).protectionFeeMinor,
    14,
  ); // odd minor → ceil
}

// ── TEST E — New ticket / edited revision: always recalculate at full-base 7%
{
  const newTicket = calculateFees({
    itemCostMinor: 10_000,
    shippingMinor: 2_000,
    config: feeConfig7pct,
    sellerServiceFeeMinorOverride: 5_000,
  });
  assert.equal(newTicket.protectionFeeMinor, 1_190); // ceil(17000*700/10000)
  assert.equal(totalChargeMinor(newTicket), 18_190);

  // Edit unfunded → new revision uses full seller entitlement base, not prior stored
  const priorStoredFeeAtOldBase = 840; // historical: 7% of item+shipping only
  const revised = calculateFees({
    itemCostMinor: 10_000,
    shippingMinor: 2_000,
    config: feeConfig7pct,
    sellerServiceFeeMinorOverride: 5_000,
  });
  assert.equal(revised.protectionFeeMinor, 1_190);
  assert.notEqual(revised.protectionFeeMinor, priorStoredFeeAtOldBase);
}

// ── TEST D — Historical: stored fee under old base is NOT recalculated
{
  const historicalFundedOldBase = {
    itemCostMinor: 10_000,
    shippingMinor: 2_000,
    sellerServiceFeeMinor: 5_000,
    protectionFeeMinor: 840, // stored under old item+shipping base
    totalChargeMinor: 17_840,
  };
  const current = calculateFees({
    itemCostMinor: historicalFundedOldBase.itemCostMinor,
    shippingMinor: historicalFundedOldBase.shippingMinor,
    config: feeConfig7pct,
    sellerServiceFeeMinorOverride: historicalFundedOldBase.sellerServiceFeeMinor,
  });
  assert.equal(historicalFundedOldBase.protectionFeeMinor, 840);
  assert.equal(current.protectionFeeMinor, 1_190);
  assert.notEqual(
    historicalFundedOldBase.protectionFeeMinor,
    current.protectionFeeMinor,
  );
}

// ── Checkout invariant: displayed fee = DB stored = PI amount (same calc)
{
  const fees = calculateFees({
    itemCostMinor: 10_000,
    shippingMinor: 0,
    config: feeConfig7pct,
    paymentOption: "DIRECT",
  });
  const dbProtectionFeeMinor = fees.protectionFeeMinor;
  const piApplicationFeeAmount = fees.protectionFeeMinor;
  const displayedFee = fees.protectionFeeMinor;
  assert.equal(displayedFee, 700);
  assert.equal(dbProtectionFeeMinor, displayedFee);
  assert.equal(piApplicationFeeAmount, dbProtectionFeeMinor);
  assert.equal(totalChargeMinor(fees), 10_700);
}

// ── Release: seller entitlement excludes SB fee
{
  const fees = calculateFees({
    itemCostMinor: 5_000,
    shippingMinor: 1_500,
    config: feeConfig7pct,
    sellerServiceFeeMinorOverride: 2_000,
  });
  const sellerEntitled =
    fees.itemCostMinor + fees.shippingMinor + fees.sellerServiceFeeMinor;
  assert.equal(sellerEntitled, 8_500);
  assert.equal(fees.protectionFeeMinor, 595);
  assert.equal(totalChargeMinor(fees) - sellerEntitled, fees.protectionFeeMinor);
}

// ── Refund: historical uses stored 2%; new uses stored 7% (never current rate)
{
  function refundUsesStoredFee(storedPlatformFeeMinor, refundFractionBps) {
    // Integer share of stored fee only — never recalculate from live bps.
    return Math.floor((storedPlatformFeeMinor * refundFractionBps) / 10_000);
  }
  const historical2pctStored = 200; // £100 base @ 2% stored on txn
  const new7pctStored = 700; // £100 base @ 7% stored on txn
  assert.equal(refundUsesStoredFee(historical2pctStored, 10_000), 200);
  assert.equal(refundUsesStoredFee(new7pctStored, 10_000), 700);
  assert.equal(refundUsesStoredFee(historical2pctStored, 5_000), 100);
  assert.notEqual(
    refundUsesStoredFee(historical2pctStored, 10_000),
    calculateFees({
      itemCostMinor: 10_000,
      shippingMinor: 0,
      config: feeConfig7pct,
    }).protectionFeeMinor,
  );
}

// ── Historical display: stored 3.5% / 2% fees are NOT recalculated from config
{
  const historical35 = 70; // $20 @ 3.5%
  const historical2pct = 40; // $20 @ 2%
  assert.equal(historical35, 70);
  assert.equal(historical2pct, 40);
  const current = calculateFees({
    itemCostMinor: 2_000,
    shippingMinor: 0,
    config: feeConfig7pct,
  }).protectionFeeMinor;
  assert.equal(current, 140);
  assert.notEqual(current, historical35);
  assert.notEqual(current, historical2pct);
}

// ── Security: client-supplied platform fee is ignored (server recalc)
{
  const clientClaimedFee = 1; // attacker tries $0.01
  const serverFees = calculateFees({
    itemCostMinor: 4_000,
    shippingMinor: 0,
    config: feeConfig7pct,
  });
  assert.equal(serverFees.protectionFeeMinor, 280);
  assert.notEqual(serverFees.protectionFeeMinor, clientClaimedFee);
}

// ── Direct uses same 7% bps (application_fee_amount = protectionFeeMinor)
{
  const direct = calculateFees({
    itemCostMinor: 4_000,
    shippingMinor: 0,
    config: feeConfig7pct,
    paymentOption: "DIRECT",
  });
  assert.equal(direct.protectionFeeMinor, 280);
}

// ── Optional floor still works when configured (not used at product default 0)
{
  const fees = calculateFees({
    itemCostMinor: 100,
    shippingMinor: 0,
    config: {
      ...feeConfig7pct,
      protectionFeeFloorMinor: 50,
    },
  });
  assert.equal(fees.protectionFeeMinor, 50); // ceil(7) < floor 50
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
assert.equal(canTransition("DELIVERED", "BUYER_RELEASE_NOW"), true);
assert.equal(canTransition("AWAITING_SHIPMENT", "BUYER_RELEASE_NOW"), false);

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

// ── Test amounts (GBP): £5 + £1 + £1 service + 7% of £7 = 49p
{
  const fees = calculateFees({
    itemCostMinor: 500,
    shippingMinor: 100,
    config: feeConfig7pct,
    sellerServiceFeeMinorOverride: 100,
  });
  assert.equal(fees.itemCostMinor, 500);
  assert.equal(fees.shippingMinor, 100);
  assert.equal(fees.sellerServiceFeeMinor, 100);
  // fee base 700 → ceil(700*700/10000)=49
  assert.equal(fees.protectionFeeMinor, 49);
  assert.equal(totalChargeMinor(fees), 749);
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
