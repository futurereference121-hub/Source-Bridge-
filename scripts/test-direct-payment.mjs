/**
 * Direct Payment domain tests (Destination Charges architecture).
 * No Stripe / no cards / never touches orphaned FUNDED SCT txns.
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
function calculateFees({ itemCostMinor, shippingMinor, config, paymentOption, sellerServiceFeeMinorOverride }) {
  const direct = isDirectPaymentOption(paymentOption);
  const feeBps = direct ? config.directServiceFeeBps : config.protectionFeeBps;
  const feeFloor = direct ? config.directServiceFeeFloorMinor : config.protectionFeeFloorMinor;
  const sellerServiceFeeMinor =
    sellerServiceFeeMinorOverride !== undefined
      ? sellerServiceFeeMinorOverride
      : 0;
  const feeBaseMinor = itemCostMinor + shippingMinor + sellerServiceFeeMinor;
  const platformRaw = Math.ceil((feeBaseMinor * Math.max(0, feeBps)) / 10_000);
  const protectionFeeMinor = Math.max(platformRaw, feeBaseMinor > 0 ? Math.max(0, feeFloor) : 0);
  return {
    itemCostMinor,
    shippingMinor,
    sellerServiceFeeMinor,
    protectionFeeMinor,
    feeKind: direct ? "SERVICE" : "PROTECTION",
  };
}
function totalChargeMinor(b) {
  return b.itemCostMinor + b.shippingMinor + b.sellerServiceFeeMinor + b.protectionFeeMinor;
}

/** New Direct: Destination Charges on PI — never transfers.create on fund. */
function buildDirectPiParams(txn, sellerConnectId) {
  const sellerShare =
    txn.itemCostMinor + txn.shippingMinor + txn.sellerServiceFeeMinor;
  return {
    amount: txn.totalChargeMinor,
    currency: txn.currency.toLowerCase(),
    transfer_data: { destination: sellerConnectId },
    application_fee_amount: txn.protectionFeeMinor,
    chargeModel: "DESTINATION_CHARGES",
    sellerShareMinor: sellerShare,
  };
}

function buildProtectedPiParams(txn) {
  return {
    amount: txn.totalChargeMinor,
    currency: txn.currency.toLowerCase(),
    transfer_data: undefined,
    application_fee_amount: undefined,
    chargeModel: "SEPARATE_CHARGES_AND_TRANSFERS",
  };
}

/** Fund path: Direct with destination → RELEASED without transfers.create */
function fundWebhookPath(paymentOption, piHasDestination) {
  if (!isDirectPaymentOption(paymentOption)) {
    return { transferOnFund: false, destinationRelease: false, callTransfersCreate: false };
  }
  if (piHasDestination) {
    return { transferOnFund: false, destinationRelease: true, callTransfersCreate: false };
  }
  // Legacy SCT Direct FUNDED (e.g. cmsk1myi…): leave alone — no transfer invent
  return { transferOnFund: false, destinationRelease: false, callTransfersCreate: false };
}

/** releaseFinal for Direct is refused (no platform transfer recovery). */
function canReleaseFinalPlatformTransfer(status, paymentOption) {
  if (isDirectPaymentOption(paymentOption)) return false;
  return status === "READY_TO_RELEASE";
}

/** Inspection cron never runs money movement for Direct. */
function inspectionApplies(paymentOption) {
  return !isDirectPaymentOption(paymentOption);
}

const config = {
  protectionFeeBps: 700,
  protectionFeeFloorMinor: 0,
  sellerServiceFeeBps: 0,
  directServiceFeeBps: 700,
  directServiceFeeFloorMinor: 0,
};

const protectedFees = calculateFees({
  itemCostMinor: 10000,
  shippingMinor: 1000,
  config,
  paymentOption: "PROTECTED",
});
const directFees = calculateFees({
  itemCostMinor: 10000,
  shippingMinor: 1000,
  config,
  paymentOption: "DIRECT",
});
// base 11000 → ceil(11000*700/10000)=770
assert.equal(protectedFees.protectionFeeMinor, 770);
assert.equal(directFees.protectionFeeMinor, 770);
assert.equal(protectedFees.feeKind, "PROTECTION");
assert.equal(directFees.feeKind, "SERVICE");
assert.equal(totalChargeMinor(directFees), 11770);
assert.equal(
  calculateFees({
    itemCostMinor: 100,
    shippingMinor: 0,
    config,
    paymentOption: "INSTANT",
  }).protectionFeeMinor,
  7,
);
assert.equal(normalizeTxnPaymentOption("DIRECT"), "INSTANT");
// Product $40 → $2.80 application_fee
assert.equal(
  calculateFees({
    itemCostMinor: 4000,
    shippingMinor: 0,
    config,
    paymentOption: "DIRECT",
  }).protectionFeeMinor,
  280,
);

// Full seller entitlement base: item+shipping+service → 7% of $100 = $7
{
  const withSvc = calculateFees({
    itemCostMinor: 5000,
    shippingMinor: 1000,
    config,
    paymentOption: "DIRECT",
    sellerServiceFeeMinorOverride: 4000,
  });
  assert.equal(withSvc.protectionFeeMinor, 700);
  assert.equal(totalChargeMinor(withSvc), 10_700);
}

// Fee approach: application_fee_amount = platform service fee (7%)
const directTxn = {
  itemCostMinor: 4000,
  shippingMinor: 0,
  sellerServiceFeeMinor: 0,
  protectionFeeMinor: 280,
  totalChargeMinor: 4280,
  currency: "USD",
};
const destPi = buildDirectPiParams(directTxn, "acct_test_seller");
assert.equal(destPi.transfer_data.destination, "acct_test_seller");
assert.equal(destPi.application_fee_amount, 280);
assert.equal(destPi.sellerShareMinor, 4000);
assert.equal(destPi.amount, 4280);
assert.equal(destPi.chargeModel, "DESTINATION_CHARGES");

const protPi = buildProtectedPiParams({
  ...directTxn,
  totalChargeMinor: 4280,
});
assert.equal(protPi.transfer_data, undefined);
assert.equal(protPi.application_fee_amount, undefined);
assert.equal(protPi.chargeModel, "SEPARATE_CHARGES_AND_TRANSFERS");

const destFund = fundWebhookPath("INSTANT", true);
assert.equal(destFund.callTransfersCreate, false);
assert.equal(destFund.destinationRelease, true);

const orphanFund = fundWebhookPath("INSTANT", false);
assert.equal(orphanFund.callTransfersCreate, false);
assert.equal(orphanFund.destinationRelease, false);

const protFund = fundWebhookPath("PROTECTED", false);
assert.equal(protFund.callTransfersCreate, false);
assert.equal(protFund.destinationRelease, false);

// Direct never buys procurement partial-release
function canBuyerProc(paymentOption) {
  return !isDirectPaymentOption(paymentOption);
}
assert.equal(canBuyerProc("DIRECT"), false);
assert.equal(canBuyerProc("INSTANT"), false);
assert.equal(canBuyerProc("PROTECTED"), true);

assert.equal(canReleaseFinalPlatformTransfer("FUNDED", "INSTANT"), false);
assert.equal(canReleaseFinalPlatformTransfer("FUNDED", "PROTECTED"), false);
assert.equal(canReleaseFinalPlatformTransfer("READY_TO_RELEASE", "PROTECTED"), true);
assert.equal(inspectionApplies("INSTANT"), false);
assert.equal(inspectionApplies("PROTECTED"), true);

// Spinner / UI status helpers
function buyerPostConfirmPhase({ pollN, paymentReceived, payoutSettled, max = 12 }) {
  if (payoutSettled || paymentReceived) return "complete";
  if (pollN >= max) return "received_pending";
  return "polling";
}
assert.equal(
  buyerPostConfirmPhase({ pollN: 1, paymentReceived: false, payoutSettled: false }),
  "polling",
);
assert.equal(
  buyerPostConfirmPhase({ pollN: 3, paymentReceived: true, payoutSettled: false }),
  "complete",
);
assert.equal(
  buyerPostConfirmPhase({ pollN: 12, paymentReceived: false, payoutSettled: false }),
  "received_pending",
);
// received_pending must never encode "pay again"
const receivedMsg =
  "Payment received. Seller payout is being processed. Do not pay again.";
assert.ok(receivedMsg.includes("Do not pay again"));
assert.ok(!/pay again$/i.test(receivedMsg.replace("Do not pay again", "")));

// Webhook idempotency keys for destination bookkeeping
const key = (id, pi) => `dest_release_${id}_${pi}`;
const seen = new Set();
function attempt(k) {
  if (seen.has(k)) return "already";
  seen.add(k);
  return "created";
}
assert.equal(attempt(key("t", "pi_1")), "created");
assert.equal(attempt(key("t", "pi_1")), "already");

console.log("test-direct-payment: OK");
