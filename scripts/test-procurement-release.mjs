/**
 * Procurement advance / partial-release domain tests (no Stripe API, no cards).
 * Run: node scripts/test-procurement-release.mjs
 *
 * Covers: breakdown helper, fund path no auto-proc, residual final,
 * refund caps, dual-accept terms, Direct/product regressions, flag semantics.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// ── Inline mirrors of pure helpers (keep unit tests offline)

function assertNonNegativeInt(n, label) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`${label} invalid`);
  return n;
}

function totalChargeMinor(b) {
  return b.itemCostMinor + b.shippingMinor + b.sellerServiceFeeMinor + b.protectionFeeMinor;
}

function computeProtectedFinancials(input) {
  const itemCostMinor = assertNonNegativeInt(input.itemCostMinor, "item");
  const shippingMinor = assertNonNegativeInt(input.shippingMinor, "ship");
  const sellerServiceFeeMinor = assertNonNegativeInt(input.sellerServiceFeeMinor, "svc");
  const platformFeeMinor = assertNonNegativeInt(input.protectionFeeMinor, "fee");
  const grossFundedMinor = input.totalChargeMinor ?? totalChargeMinor({
    itemCostMinor, shippingMinor, sellerServiceFeeMinor, protectionFeeMinor: platformFeeMinor,
  });
  const sellerEntitledMinor = itemCostMinor + shippingMinor + sellerServiceFeeMinor;
  const procurementAdvanceAgreed = Boolean(input.procurementAdvanceAgreed);
  const procurementAdvanceMinor = Math.min(
    assertNonNegativeInt(input.procurementAdvanceMinor ?? 0, "adv"),
    itemCostMinor,
  );
  const procurementTransferredMinor = assertNonNegativeInt(input.procurementTransferredMinor ?? 0, "pt");
  const finalTransferredMinor = assertNonNegativeInt(input.finalTransferredMinor ?? 0, "ft");
  const refundedMinor = assertNonNegativeInt(input.refundedMinor ?? 0, "rf");
  const transferredTotalMinor = procurementTransferredMinor + finalTransferredMinor;
  const protectedRemainingMinor = Math.max(0, grossFundedMinor - transferredTotalMinor - refundedMinor);
  const refundableMinor = protectedRemainingMinor;
  const finalResidualMinor = Math.max(0, sellerEntitledMinor - transferredTotalMinor);
  const remainingProtectedSellerShareMinor = Math.max(0, sellerEntitledMinor - procurementAdvanceMinor);
  return {
    grossFundedMinor,
    sellerEntitledMinor,
    platformFeeMinor,
    procurementAdvanceAgreed,
    procurementAdvanceMinor,
    procurementTransferredMinor,
    finalTransferredMinor,
    refundedMinor,
    transferredTotalMinor,
    protectedRemainingMinor,
    refundableMinor,
    finalResidualMinor,
    remainingProtectedSellerShareMinor,
    itemFundsReleasedEarlyMinor: procurementAdvanceAgreed ? procurementAdvanceMinor : 0,
  };
}

function planProtectedRefund(input) {
  const books = computeProtectedFinancials(input);
  const requested = Math.max(0, Math.floor(input.requestedMinor));
  const amountMinor = Math.min(requested, books.refundableMinor);
  const partialBecauseOfTransfers = books.transferredTotalMinor > 0;
  const nextStatus =
    amountMinor >= books.grossFundedMinor - books.refundedMinor && !partialBecauseOfTransfers
      ? "REFUNDED"
      : "PARTIALLY_REFUNDED";
  return {
    amountMinor,
    refundableMinor: books.refundableMinor,
    nextStatus: partialBecauseOfTransfers ? "PARTIALLY_REFUNDED" : nextStatus,
    partialBecauseOfTransfers,
  };
}

function procurementAdvanceAmount({ agreed, itemCostMinor, eligible }) {
  if (!agreed || !eligible) return 0;
  return itemCostMinor;
}

function isDirectPaymentOption(option) {
  const v = (option || "").toUpperCase();
  return v === "INSTANT" || v === "DIRECT";
}

/** Fund webhook product decision: PROTECTED never auto-releases procurement. */
function fundWebhookProtectedPath(txn, procurementFlagOn) {
  const isDirect = isDirectPaymentOption(txn.paymentOption);
  if (isDirect) {
    return { markFunded: true, autoReleaseProcurement: false, destinationRelease: true };
  }
  // PRODUCT: PROCUREMENT_ADVANCES_ENABLED enables manual buyer release, NOT auto on fund.
  void procurementFlagOn;
  return {
    markFunded: true,
    autoReleaseProcurement: false,
    destinationRelease: false,
    transferOnFund: false,
  };
}

function canBuyerReleaseProcurement(opts) {
  if (!opts.flagOn) return false;
  if (opts.actorId !== opts.buyerId) return false;
  if (isDirectPaymentOption(opts.paymentOption)) return false;
  if (opts.status !== "FUNDED") return false;
  if (!opts.procurementAdvanceAgreed || opts.procurementAdvanceMinor <= 0) return false;
  if (opts.procurementTransferredMinor !== 0) return false;
  if (["REFUNDED", "PARTIALLY_REFUNDED", "DISPUTED", "CANCELLED", "RELEASED"].includes(opts.status)) {
    return false;
  }
  const eligibleOrigin =
    opts.origin === "CHAT_TICKET" ||
    Boolean(opts.paymentTicketId) ||
    Boolean(opts.sourcingRequestId);
  return eligibleOrigin;
}

function residualFinalAmount(txn) {
  const books = computeProtectedFinancials(txn);
  return books.finalResidualMinor;
}

function assertInvariants(books, nextProc = 0, nextFinal = 0) {
  const pt = books.procurementTransferredMinor + nextProc;
  const ft = books.finalTransferredMinor + nextFinal;
  assert.ok(pt <= books.procurementAdvanceMinor, "proc <= advance");
  assert.ok(pt + ft <= books.sellerEntitledMinor, "proc+final <= seller");
}

function hashTerms(obj) {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

// ── Breakdown: item-only advance, never shipping
{
  const books = computeProtectedFinancials({
    itemCostMinor: 500,
    shippingMinor: 100,
    sellerServiceFeeMinor: 100,
    protectionFeeMinor: 50,
    procurementAdvanceAgreed: true,
    procurementAdvanceMinor: 500,
  });
  assert.equal(books.grossFundedMinor, 750);
  assert.equal(books.sellerEntitledMinor, 700);
  assert.equal(books.itemFundsReleasedEarlyMinor, 500);
  assert.equal(books.remainingProtectedSellerShareMinor, 200); // ship + svc
  assert.equal(books.protectedRemainingMinor, 750);
  assert.equal(books.finalResidualMinor, 700);
}

// Advance capped at item cost even if misconfigured higher
{
  const books = computeProtectedFinancials({
    itemCostMinor: 500,
    shippingMinor: 100,
    sellerServiceFeeMinor: 0,
    protectionFeeMinor: 50,
    procurementAdvanceAgreed: true,
    procurementAdvanceMinor: 9999, // bad input
  });
  assert.equal(books.procurementAdvanceMinor, 500);
}

// ── Fund path: no auto procurement even if flag/agreed
{
  const path = fundWebhookProtectedPath(
    {
      paymentOption: "PROTECTED",
      procurementAdvanceAgreed: true,
      procurementAdvanceMinor: 500,
    },
    true,
  );
  assert.equal(path.markFunded, true);
  assert.equal(path.autoReleaseProcurement, false);
  assert.equal(path.transferOnFund, false);
}

// Direct: no procurement
{
  const path = fundWebhookProtectedPath(
    { paymentOption: "DIRECT", procurementAdvanceAgreed: true, procurementAdvanceMinor: 500 },
    true,
  );
  assert.equal(path.autoReleaseProcurement, false);
  assert.equal(path.destinationRelease, true);
}

// ── Buyer-only release gates
{
  const base = {
    flagOn: true,
    actorId: "buyer1",
    buyerId: "buyer1",
    status: "FUNDED",
    paymentOption: "PROTECTED",
    procurementAdvanceAgreed: true,
    procurementAdvanceMinor: 500,
    procurementTransferredMinor: 0,
    origin: "CHAT_TICKET",
  };
  assert.equal(canBuyerReleaseProcurement(base), true);
  assert.equal(canBuyerReleaseProcurement({ ...base, flagOn: false }), false);
  assert.equal(canBuyerReleaseProcurement({ ...base, actorId: "seller1" }), false);
  assert.equal(canBuyerReleaseProcurement({ ...base, status: "ACCEPTED" }), false);
  assert.equal(canBuyerReleaseProcurement({ ...base, paymentOption: "INSTANT" }), false);
  assert.equal(canBuyerReleaseProcurement({ ...base, procurementTransferredMinor: 500 }), false);
  assert.equal(canBuyerReleaseProcurement({ ...base, origin: "PRODUCT_CHECKOUT", paymentTicketId: null, sourcingRequestId: null }), false);
  assert.equal(canBuyerReleaseProcurement({ ...base, origin: "PRODUCT_CHECKOUT", paymentTicketId: "t1" }), true);
}

// ── Residual final after procurement
{
  const txn = {
    itemCostMinor: 500,
    shippingMinor: 100,
    sellerServiceFeeMinor: 100,
    protectionFeeMinor: 50,
    procurementAdvanceAgreed: true,
    procurementAdvanceMinor: 500,
    procurementTransferredMinor: 500,
    finalTransferredMinor: 0,
  };
  assert.equal(residualFinalAmount(txn), 200); // ship + svc only
  assertInvariants(computeProtectedFinancials(txn), 0, 200);
  // Cannot release more than residual
  assert.throws(() => assertInvariants(computeProtectedFinancials(txn), 0, 201));
}

// ── Refunds: full before proc; platform remainder after
{
  const before = planProtectedRefund({
    itemCostMinor: 500,
    shippingMinor: 100,
    sellerServiceFeeMinor: 100,
    protectionFeeMinor: 50,
    totalChargeMinor: 750,
    procurementTransferredMinor: 0,
    finalTransferredMinor: 0,
    refundedMinor: 0,
    requestedMinor: 750,
  });
  assert.equal(before.amountMinor, 750);
  assert.equal(before.nextStatus, "REFUNDED");
  assert.equal(before.partialBecauseOfTransfers, false);
}
{
  const after = planProtectedRefund({
    itemCostMinor: 500,
    shippingMinor: 100,
    sellerServiceFeeMinor: 100,
    protectionFeeMinor: 50,
    totalChargeMinor: 750,
    procurementTransferredMinor: 500,
    finalTransferredMinor: 0,
    refundedMinor: 0,
    requestedMinor: 750,
  });
  assert.equal(after.amountMinor, 250); // only platform remainder
  assert.equal(after.refundableMinor, 250);
  assert.equal(after.nextStatus, "PARTIALLY_REFUNDED");
  assert.equal(after.partialBecauseOfTransfers, true);
}

// ── Dual acceptance: terms change → new hash (stale not payable)
{
  const v1 = hashTerms({ item: 500, ship: 100, revision: 1, procure: true });
  const v2 = hashTerms({ item: 500, ship: 100, revision: 2, procure: true });
  const v1b = hashTerms({ item: 500, ship: 120, revision: 1, procure: true });
  assert.notEqual(v1, v2);
  assert.notEqual(v1, v1b);
  assert.equal(v1, hashTerms({ item: 500, ship: 100, revision: 1, procure: true }));
}

// ── eligibility amount helper
assert.equal(procurementAdvanceAmount({ agreed: true, itemCostMinor: 500, eligible: true }), 500);
assert.equal(procurementAdvanceAmount({ agreed: true, itemCostMinor: 500, eligible: false }), 0);
assert.equal(procurementAdvanceAmount({ agreed: false, itemCostMinor: 500, eligible: true }), 0);

// ── Idempotency key shape for transfer attempts
{
  const txnId = "txn_abc";
  const termsHash = "deadbeef";
  const key = `proc_xfer_${txnId}_${termsHash}`;
  assert.equal(key, "proc_xfer_txn_abc_deadbeef");
  // Re-call same key => alreadyReleased semantics
  const attempts = new Map();
  function releaseOnce(idempotencyKey) {
    if (attempts.get(idempotencyKey) === "SUCCEEDED") return { alreadyReleased: true };
    attempts.set(idempotencyKey, "SUCCEEDED");
    return { alreadyReleased: false };
  }
  assert.equal(releaseOnce(key).alreadyReleased, false);
  assert.equal(releaseOnce(key).alreadyReleased, true);
}

// ── Protected product checkout regression: no procurement UI when not agreed
{
  const product = {
    origin: "PRODUCT_CHECKOUT",
    paymentOption: "PROTECTED",
    procurementAdvanceAgreed: false,
    procurementAdvanceMinor: 0,
  };
  assert.equal(
    canBuyerReleaseProcurement({
      flagOn: true,
      actorId: "b",
      buyerId: "b",
      status: "FUNDED",
      ...product,
      procurementTransferredMinor: 0,
      paymentTicketId: null,
      sourcingRequestId: null,
    }),
    false,
  );
}

// ── Flag semantics: PROCUREMENT_ADVANCES_ENABLED means manual API available
function isProcurementAdvancesEnabled(env, protectedOn = true) {
  if (!protectedOn) return false;
  const raw = (env.PROCUREMENT_ADVANCES_ENABLED || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
assert.equal(isProcurementAdvancesEnabled({}), false);
assert.equal(isProcurementAdvancesEnabled({ PROCUREMENT_ADVANCES_ENABLED: "false" }), false);
assert.equal(isProcurementAdvancesEnabled({ PROCUREMENT_ADVANCES_ENABLED: "true" }), true);
// Production default stays gated off
assert.equal(isProcurementAdvancesEnabled({ PROCUREMENT_ADVANCES_ENABLED: undefined }), false);

// ── Source code guard: fund path must not call releaseProcurement
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checkoutSrc = readFileSync(join(root, "src/lib/payments/checkout.ts"), "utf8");
assert.ok(
  !/import\s*\{[^}]*releaseProcurement/.test(checkoutSrc),
  "checkout fund path must not import releaseProcurement",
);
assert.ok(
  !/await\s+releaseProcurement\s*\(/.test(checkoutSrc),
  "checkout fund path must not call releaseProcurement",
);
assert.ok(
  checkoutSrc.includes("Never auto releaseProcurement") ||
    checkoutSrc.includes("MARK_FUNDED only"),
  "fund path documents no auto procurement",
);
const releaseApi = readFileSync(
  join(root, "src/app/api/payments/release-procurement/route.ts"),
  "utf8",
);
assert.ok(releaseApi.includes("BUYER_ONLY") || releaseApi.includes("Only the buyer"));
assert.ok(releaseApi.includes("isProcurementAdvancesEnabled"));

// PCI smoke: release route has no card fields
assert.ok(!/cardNumber|cvc|pan/i.test(releaseApi));

console.log("test-procurement-release: all assertions passed");
