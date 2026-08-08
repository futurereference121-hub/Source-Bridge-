/**
 * Direct Payment domain tests (fees + fund/transfer rules). No Stripe / no cards.
 * Run: node scripts/test-direct-payment.mjs
 */
import assert from "node:assert/strict";
function isDirectPaymentOption(option) {
  const v = (option || "").toUpperCase();
  return v === "INSTANT" || v === "DIRECT";
}
function normalizeTxnPaymentOption(raw) {
  if (isDirectPaymentOption(raw)) return "INSTANT";
  return "PROTECTED";
}
function calculateFees({ itemCostMinor, shippingMinor, config, paymentOption }) {
  const base = itemCostMinor + shippingMinor;
  const direct = isDirectPaymentOption(paymentOption);
  const feeBps = direct ? config.directServiceFeeBps : config.protectionFeeBps;
  const feeFloor = direct ? config.directServiceFeeFloorMinor : config.protectionFeeFloorMinor;
  const platformRaw = Math.ceil((base * Math.max(0, feeBps)) / 10_000);
  const protectionFeeMinor = Math.max(platformRaw, base > 0 ? Math.max(0, feeFloor) : 0);
  return { itemCostMinor, shippingMinor, sellerServiceFeeMinor: 0, protectionFeeMinor, feeKind: direct ? "SERVICE" : "PROTECTION" };
}
function totalChargeMinor(b) {
  return b.itemCostMinor + b.shippingMinor + b.sellerServiceFeeMinor + b.protectionFeeMinor;
}
function shouldTransferOnFund(paymentOption, directFlagOn) {
  return isDirectPaymentOption(paymentOption) && directFlagOn;
}
function canReleaseFinal(status, paymentOption) {
  const ok = { READY_TO_RELEASE: 1, FUNDED: 1, PROCUREMENT_RELEASED: 1 };
  if (!ok[status]) return false;
  if (!isDirectPaymentOption(paymentOption) && status !== "READY_TO_RELEASE") return false;
  return true;
}
const config = { protectionFeeBps: 350, protectionFeeFloorMinor: 50, sellerServiceFeeBps: 0, directServiceFeeBps: 250, directServiceFeeFloorMinor: 40 };
const protectedFees = calculateFees({ itemCostMinor: 10000, shippingMinor: 1000, config, paymentOption: "PROTECTED" });
const directFees = calculateFees({ itemCostMinor: 10000, shippingMinor: 1000, config, paymentOption: "DIRECT" });
assert.equal(protectedFees.protectionFeeMinor, 385);
assert.equal(directFees.protectionFeeMinor, 275);
assert.equal(protectedFees.feeKind, "PROTECTION");
assert.equal(directFees.feeKind, "SERVICE");
assert.equal(totalChargeMinor(directFees), 11275);
assert.equal(calculateFees({ itemCostMinor: 100, shippingMinor: 0, config, paymentOption: "INSTANT" }).protectionFeeMinor, 40);
assert.equal(normalizeTxnPaymentOption("DIRECT"), "INSTANT");
assert.equal(shouldTransferOnFund("PROTECTED", true), false);
assert.equal(shouldTransferOnFund("INSTANT", true), true);
assert.equal(shouldTransferOnFund("DIRECT", true), true);
assert.equal(canReleaseFinal("FUNDED", "PROTECTED"), false);
assert.equal(canReleaseFinal("FUNDED", "INSTANT"), true);
assert.equal(canReleaseFinal("READY_TO_RELEASE", "PROTECTED"), true);
const key = (id, h) => `final_xfer_${id}_${h}`;
const seen = new Set();
function attempt(k) { if (seen.has(k)) return "already"; seen.add(k); return "created"; }
assert.equal(attempt(key("t","h")), "created");
assert.equal(attempt(key("t","h")), "already");
assert.notEqual(config.directServiceFeeFloorMinor, 70);
console.log("test-direct-payment: OK");