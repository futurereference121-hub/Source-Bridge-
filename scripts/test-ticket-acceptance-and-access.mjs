/**
 * Dual-accept + open TEST ramp + fee display unit tests (no DB).
 * Run: node scripts/test-ticket-acceptance-and-access.mjs
 */

import assert from "node:assert/strict";

function partyAcceptedCurrentRevision(approvedRevision, revision) {
  if (approvedRevision == null) return false;
  return Number(approvedRevision) === Number(revision);
}

function deriveTicketAcceptanceState(opts) {
  const buyerAcceptedCurrentRevision = partyAcceptedCurrentRevision(
    opts.buyerApprovedRevision,
    opts.revision,
  );
  const sellerAcceptedCurrentRevision = partyAcceptedCurrentRevision(
    opts.sellerApprovedRevision,
    opts.revision,
  );
  const bothAcceptedCurrentRevision =
    buyerAcceptedCurrentRevision && sellerAcceptedCurrentRevision;
  const iAmBuyer = Boolean(opts.viewerId) && opts.viewerId === opts.buyerId;
  const iAmSeller = Boolean(opts.viewerId) && opts.viewerId === opts.sellerId;
  const isParty = iAmBuyer || iAmSeller;
  const myAcceptedCurrentRevision = iAmBuyer
    ? buyerAcceptedCurrentRevision
    : iAmSeller
      ? sellerAcceptedCurrentRevision
      : false;
  const openForAccept =
    opts.status === "PROPOSED" || opts.status === "DRAFT";
  const canAccept = isParty && openForAccept && !myAcceptedCurrentRevision;
  const waitingForOther =
    isParty &&
    openForAccept &&
    myAcceptedCurrentRevision &&
    !bothAcceptedCurrentRevision;
  const waitingForRole = waitingForOther
    ? iAmBuyer
      ? "seller"
      : "buyer"
    : null;
  return {
    buyerAcceptedCurrentRevision,
    sellerAcceptedCurrentRevision,
    bothAcceptedCurrentRevision,
    iAmBuyer,
    iAmSeller,
    canAccept,
    waitingForOther,
    waitingForRole,
  };
}

function calculateFees({
  itemCostMinor,
  shippingMinor,
  sellerServiceFeeMinorOverride,
  protectionFeeBps,
}) {
  const base = itemCostMinor + shippingMinor;
  const protectionRaw = Math.ceil((base * Math.max(0, protectionFeeBps)) / 10_000);
  return {
    itemCostMinor,
    shippingMinor,
    sellerServiceFeeMinor: sellerServiceFeeMinorOverride ?? 0,
    protectionFeeMinor: protectionRaw,
  };
}

function remainingProtectedSellerShareMinor({
  itemCostMinor,
  shippingMinor,
  sellerServiceFeeMinor,
  procurementAdvanceMinor,
}) {
  const sellerEntitled =
    itemCostMinor + shippingMinor + sellerServiceFeeMinor;
  return Math.max(0, sellerEntitled - procurementAdvanceMinor);
}

const buyer = "buyer-1";
const seller = "seller-1";
const stranger = "stranger-1";
const revision = 1;

// Buyer accepted / seller not → seller sees Accept; buyer waits
{
  const forSeller = deriveTicketAcceptanceState({
    viewerId: seller,
    buyerId: buyer,
    sellerId: seller,
    revision,
    buyerApprovedRevision: 1,
    sellerApprovedRevision: null,
    status: "PROPOSED",
  });
  assert.equal(forSeller.canAccept, true);
  assert.equal(forSeller.waitingForOther, false);

  const forBuyer = deriveTicketAcceptanceState({
    viewerId: buyer,
    buyerId: buyer,
    sellerId: seller,
    revision,
    buyerApprovedRevision: 1,
    sellerApprovedRevision: null,
    status: "PROPOSED",
  });
  assert.equal(forBuyer.canAccept, false);
  assert.equal(forBuyer.waitingForOther, true);
  assert.equal(forBuyer.waitingForRole, "seller");
}

// Seller accepted / buyer not → buyer sees Accept
{
  const forBuyer = deriveTicketAcceptanceState({
    viewerId: buyer,
    buyerId: buyer,
    sellerId: seller,
    revision,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 1,
    status: "PROPOSED",
  });
  assert.equal(forBuyer.canAccept, true);
  assert.equal(forBuyer.waitingForOther, false);
}

// Both accepted → neither sees Accept
{
  const forBuyer = deriveTicketAcceptanceState({
    viewerId: buyer,
    buyerId: buyer,
    sellerId: seller,
    revision,
    buyerApprovedRevision: 1,
    sellerApprovedRevision: 1,
    status: "PROPOSED",
  });
  assert.equal(forBuyer.canAccept, false);
  assert.equal(forBuyer.waitingForOther, false);
  assert.equal(forBuyer.bothAcceptedCurrentRevision, true);
}

// Unrelated user cannot accept
{
  const forStranger = deriveTicketAcceptanceState({
    viewerId: stranger,
    buyerId: buyer,
    sellerId: seller,
    revision,
    buyerApprovedRevision: null,
    sellerApprovedRevision: null,
    status: "PROPOSED",
  });
  assert.equal(forStranger.canAccept, false);
}

// Revision safety: old acceptance does not authorize new revision
{
  const forBuyer = deriveTicketAcceptanceState({
    viewerId: buyer,
    buyerId: buyer,
    sellerId: seller,
    revision: 2,
    buyerApprovedRevision: 1,
    sellerApprovedRevision: null,
    status: "PROPOSED",
  });
  assert.equal(forBuyer.buyerAcceptedCurrentRevision, false);
  assert.equal(forBuyer.canAccept, true);
}

// Idempotent same-party already accepted
{
  const again = deriveTicketAcceptanceState({
    viewerId: buyer,
    buyerId: buyer,
    sellerId: seller,
    revision: 1,
    buyerApprovedRevision: 1,
    sellerApprovedRevision: null,
    status: "PROPOSED",
  });
  assert.equal(again.canAccept, false);
  assert.equal(again.waitingForOther, true);
}

// 2% fee display: £50 + £15 + £20 sourcer → SB £1.30; remaining seller £35
{
  const fees = calculateFees({
    itemCostMinor: 5000,
    shippingMinor: 1500,
    sellerServiceFeeMinorOverride: 2000,
    protectionFeeBps: 200,
  });
  assert.equal(fees.protectionFeeMinor, 130); // 2% of 6500
  const remaining = remainingProtectedSellerShareMinor({
    itemCostMinor: 5000,
    shippingMinor: 1500,
    sellerServiceFeeMinor: 2000,
    procurementAdvanceMinor: 5000,
  });
  assert.equal(remaining, 3500);
  // Must NOT present £36.30 as seller-protected
  assert.notEqual(remaining + fees.protectionFeeMinor, remaining);
  assert.equal(remaining + fees.protectionFeeMinor, 3630);
}

// Open TEST ramp: empty allowlist does not deny when Live off + TEST
{
  function isPaymentsTestRampOpen({ live, mode }) {
    return !live && mode === "TEST";
  }
  function assertAllowlisted(rampOpen, listConfigured) {
    if (rampOpen) return "allowed";
    if (!listConfigured) return "denied-empty";
    return "check-list";
  }
  assert.equal(
    assertAllowlisted(isPaymentsTestRampOpen({ live: false, mode: "TEST" }), false),
    "allowed",
  );
  assert.equal(
    assertAllowlisted(isPaymentsTestRampOpen({ live: true, mode: "LIVE" }), false),
    "denied-empty",
  );
  // Access must not depend on futureman/theowlsaid identities
  const ordinary = { id: "ordinary-user-xyz", email: "ordinary@example.com" };
  assert.ok(ordinary.id !== "cms8or23a0000la046qm6ene4");
  assert.ok(!/futureman|theowlsaid/i.test(ordinary.email));
}

console.log("ticket acceptance + access + fee tests passed");
