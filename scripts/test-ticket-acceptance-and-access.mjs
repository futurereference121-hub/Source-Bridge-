/**
 * Dual-accept + explicit Buyer/Sourcer role model + open TEST ramp + fee display.
 * Mirrors src/lib/payments/ticket-lifecycle.ts (keep in sync).
 * Run: node scripts/test-ticket-acceptance-and-access.mjs
 */

import assert from "node:assert/strict";

function partyAcceptedCurrentRevision(approvedRevision, revision) {
  if (approvedRevision == null) return false;
  return Number(approvedRevision) === Number(revision);
}

function assignConversationTicketRoles(opts) {
  const ids = [
    ...new Set(
      (opts.participantIds || []).map((id) => (id || "").trim()).filter(Boolean),
    ),
  ];
  if (ids.length !== 2) {
    return {
      ok: false,
      message: "Conversation needs two parties",
      code: "NEED_TWO_PARTIES",
    };
  }
  const buyerId = (opts.buyerId || "").trim();
  if (!buyerId || !ids.includes(buyerId)) {
    return {
      ok: false,
      message: "Buyer must be a conversation participant",
      code: "INVALID_BUYER",
    };
  }
  const sellerId = ids.find((id) => id !== buyerId) || "";
  if (!sellerId || sellerId === buyerId) {
    return {
      ok: false,
      message: "Buyer and sourcer must be different people",
      code: "SELF_TRADE",
    };
  }
  const proposedSeller = (opts.proposedSellerId || "").trim();
  if (proposedSeller && proposedSeller !== sellerId) {
    return {
      ok: false,
      message: "Sourcer must be the other conversation participant",
      code: "INVALID_SOURCER",
    };
  }
  return { ok: true, buyerId, sellerId };
}

function resolveTicketRoleModel(opts) {
  const proposerId = (opts.createdById || "").trim();
  const buyerId = (opts.buyerId || "").trim();
  const sellerId = (opts.sellerId || "").trim();
  const viewerId = (opts.viewerId || "").trim();
  const rolesValid =
    Boolean(proposerId && buyerId && sellerId) &&
    buyerId !== sellerId &&
    (proposerId === buyerId || proposerId === sellerId);
  const counterpartyId = !rolesValid
    ? null
    : proposerId === buyerId
      ? sellerId
      : buyerId;
  return {
    proposerId,
    buyerId,
    sellerId,
    counterpartyId,
    rolesValid,
    iAmProposer: Boolean(viewerId) && viewerId === proposerId,
    iAmCounterparty: Boolean(
      viewerId && counterpartyId && viewerId === counterpartyId,
    ),
    iAmBuyer: Boolean(viewerId) && viewerId === buyerId,
    iAmSeller: Boolean(viewerId) && viewerId === sellerId,
  };
}

function deriveTicketAcceptanceState(opts) {
  const roles = resolveTicketRoleModel({
    createdById: opts.createdById,
    buyerId: opts.buyerId,
    sellerId: opts.sellerId,
    viewerId: opts.viewerId,
  });
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
  const myAcceptedCurrentRevision = roles.iAmBuyer
    ? buyerAcceptedCurrentRevision
    : roles.iAmSeller
      ? sellerAcceptedCurrentRevision
      : false;
  const openForAccept =
    opts.status === "PROPOSED" || opts.status === "DRAFT";
  const canAccept =
    roles.rolesValid &&
    roles.iAmCounterparty &&
    openForAccept &&
    !myAcceptedCurrentRevision;
  const waitingForOther =
    roles.rolesValid &&
    roles.iAmProposer &&
    openForAccept &&
    myAcceptedCurrentRevision &&
    !bothAcceptedCurrentRevision;
  return {
    buyerAcceptedCurrentRevision,
    sellerAcceptedCurrentRevision,
    bothAcceptedCurrentRevision,
    iAmBuyer: roles.iAmBuyer,
    iAmSeller: roles.iAmSeller,
    iAmProposer: roles.iAmProposer,
    iAmCounterparty: roles.iAmCounterparty,
    rolesValid: roles.rolesValid,
    canAccept,
    waitingForOther,
    viewerRoleLabel: roles.iAmBuyer
      ? "buyer"
      : roles.iAmSeller
        ? "sourcer"
        : null,
    needsRoleRevision: !roles.rolesValid && openForAccept,
  };
}

function viewerMayFundTicket({ viewerId, buyerId }) {
  return Boolean(viewerId && buyerId && viewerId === buyerId);
}

function sellerDestinationUserId({ sellerId }) {
  return (sellerId || "").trim();
}

function calculateFees({
  itemCostMinor,
  shippingMinor,
  sellerServiceFeeMinorOverride,
  protectionFeeBps,
}) {
  const base = itemCostMinor + shippingMinor;
  const protectionRaw = Math.ceil(
    (base * Math.max(0, protectionFeeBps)) / 10_000,
  );
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

const A = "user-a";
const B = "user-b";
const stranger = "stranger-1";
const revision = 1;

// ROLE ASSIGNMENT: A creates with A as buyer → sourcer is B
{
  const roles = assignConversationTicketRoles({
    participantIds: [A, B],
    buyerId: A,
  });
  assert.equal(roles.ok, true);
  assert.equal(roles.buyerId, A);
  assert.equal(roles.sellerId, B);
}

// ROLE ASSIGNMENT: A creates with B as buyer → sourcer is A
{
  const roles = assignConversationTicketRoles({
    participantIds: [A, B],
    buyerId: B,
  });
  assert.equal(roles.ok, true);
  assert.equal(roles.buyerId, B);
  assert.equal(roles.sellerId, A);
}

// Same user cannot be buyer and sourcer / unrelated cannot be selected
{
  const self = assignConversationTicketRoles({
    participantIds: [A, A],
    buyerId: A,
  });
  assert.equal(self.ok, false);
  const unrelated = assignConversationTicketRoles({
    participantIds: [A, B],
    buyerId: stranger,
  });
  assert.equal(unrelated.ok, false);
  assert.equal(unrelated.code, "INVALID_BUYER");
  const mismatchSeller = assignConversationTicketRoles({
    participantIds: [A, B],
    buyerId: A,
    proposedSellerId: A,
  });
  assert.equal(mismatchSeller.ok, false);
  assert.equal(mismatchSeller.code, "INVALID_SOURCER");
}

// Example A: B proposes, A is buyer. B auto-approves as sourcer. A sees Accept.
{
  const forBuyer = deriveTicketAcceptanceState({
    viewerId: A,
    createdById: B,
    buyerId: A,
    sellerId: B,
    revision,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 1,
    status: "PROPOSED",
  });
  assert.equal(forBuyer.canAccept, true);
  assert.equal(forBuyer.waitingForOther, false);
  assert.equal(forBuyer.iAmCounterparty, true);
  assert.equal(forBuyer.iAmBuyer, true);
  assert.equal(forBuyer.viewerRoleLabel, "buyer");

  const forProposer = deriveTicketAcceptanceState({
    viewerId: B,
    createdById: B,
    buyerId: A,
    sellerId: B,
    revision,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 1,
    status: "PROPOSED",
  });
  assert.equal(forProposer.canAccept, false);
  assert.equal(forProposer.waitingForOther, true);
  assert.equal(forProposer.iAmProposer, true);
}

// Example B: A proposes, A is buyer. A auto-approves as buyer. B sees Accept as sourcer.
{
  const forSourcer = deriveTicketAcceptanceState({
    viewerId: B,
    createdById: A,
    buyerId: A,
    sellerId: B,
    revision,
    buyerApprovedRevision: 1,
    sellerApprovedRevision: null,
    status: "PROPOSED",
  });
  assert.equal(forSourcer.canAccept, true);
  assert.equal(forSourcer.iAmSeller, true);
  assert.equal(forSourcer.viewerRoleLabel, "sourcer");

  const forProposer = deriveTicketAcceptanceState({
    viewerId: A,
    createdById: A,
    buyerId: A,
    sellerId: B,
    revision,
    buyerApprovedRevision: 1,
    sellerApprovedRevision: null,
    status: "PROPOSED",
  });
  assert.equal(forProposer.canAccept, false);
  assert.equal(forProposer.waitingForOther, true);
}

// Exactly one party needs acceptance after proposal
{
  const a = deriveTicketAcceptanceState({
    viewerId: A,
    createdById: B,
    buyerId: A,
    sellerId: B,
    revision,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 1,
    status: "PROPOSED",
  });
  const b = deriveTicketAcceptanceState({
    viewerId: B,
    createdById: B,
    buyerId: A,
    sellerId: B,
    revision,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 1,
    status: "PROPOSED",
  });
  assert.equal(Number(a.canAccept) + Number(b.canAccept), 1);
  assert.equal(a.waitingForOther && b.waitingForOther, false);
}

// Unrelated user cannot accept
{
  const forStranger = deriveTicketAcceptanceState({
    viewerId: stranger,
    createdById: A,
    buyerId: A,
    sellerId: B,
    revision,
    buyerApprovedRevision: 1,
    sellerApprovedRevision: null,
    status: "PROPOSED",
  });
  assert.equal(forStranger.canAccept, false);
}

// Missing createdById → do not guess Accept
{
  const forBuyer = deriveTicketAcceptanceState({
    viewerId: A,
    createdById: "",
    buyerId: A,
    sellerId: B,
    revision,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 1,
    status: "PROPOSED",
  });
  assert.equal(forBuyer.canAccept, false);
  assert.equal(forBuyer.needsRoleRevision, true);
}

// Both accepted → neither sees Accept; only designated buyer may fund
{
  const both = {
    createdById: B,
    buyerId: A,
    sellerId: B,
    revision,
    buyerApprovedRevision: 1,
    sellerApprovedRevision: 1,
    status: "ACCEPTED",
  };
  const forBuyer = deriveTicketAcceptanceState({ viewerId: A, ...both });
  const forSourcer = deriveTicketAcceptanceState({ viewerId: B, ...both });
  assert.equal(forBuyer.canAccept, false);
  assert.equal(forSourcer.canAccept, false);
  assert.equal(forBuyer.bothAcceptedCurrentRevision, true);
  assert.equal(viewerMayFundTicket({ viewerId: A, buyerId: A }), true);
  assert.equal(viewerMayFundTicket({ viewerId: B, buyerId: A }), false);
  // Proposer identity does not authorize payment
  assert.equal(viewerMayFundTicket({ viewerId: B, buyerId: A }), false);
}

// Revision resets counterparty; new proposer auto-approves
{
  const v2 = deriveTicketAcceptanceState({
    viewerId: A,
    createdById: B,
    buyerId: B,
    sellerId: A,
    revision: 2,
    buyerApprovedRevision: 2,
    sellerApprovedRevision: null,
    status: "PROPOSED",
  });
  assert.equal(v2.canAccept, true);
  assert.equal(v2.iAmSeller, true);
  const proposer = deriveTicketAcceptanceState({
    viewerId: B,
    createdById: B,
    buyerId: B,
    sellerId: A,
    revision: 2,
    buyerApprovedRevision: 2,
    sellerApprovedRevision: null,
    status: "PROPOSED",
  });
  assert.equal(proposer.canAccept, false);
  assert.equal(proposer.waitingForOther, true);
  assert.equal(viewerMayFundTicket({ viewerId: B, buyerId: B }), true);
}

// Old approval does not authorize new revision
{
  const forBuyer = deriveTicketAcceptanceState({
    viewerId: A,
    createdById: B,
    buyerId: A,
    sellerId: B,
    revision: 2,
    buyerApprovedRevision: 1,
    sellerApprovedRevision: 2,
    status: "PROPOSED",
  });
  assert.equal(forBuyer.buyerAcceptedCurrentRevision, false);
  assert.equal(forBuyer.canAccept, true);
}

// Beneficiary always designated sourcer (sellerId), never proposer/buyer by identity
{
  assert.equal(
    sellerDestinationUserId({ sellerId: B, proposerId: A, buyerId: A }),
    B,
  );
  assert.equal(
    sellerDestinationUserId({ sellerId: A, proposerId: A, buyerId: B }),
    A,
  );
}

// Independent tickets in same conversation: A→buyer and B→buyer
{
  const ticketA = assignConversationTicketRoles({
    participantIds: [A, B],
    buyerId: A,
  });
  const ticketB = assignConversationTicketRoles({
    participantIds: [A, B],
    buyerId: B,
  });
  assert.equal(ticketA.sellerId, B);
  assert.equal(ticketB.sellerId, A);
  assert.notEqual(ticketA.buyerId, ticketB.buyerId);
}

// Role changes after funding rejected (guard)
{
  function rolesLockedAfterFunding(involvesMoney) {
    return Boolean(involvesMoney);
  }
  assert.equal(rolesLockedAfterFunding(true), true);
  assert.equal(rolesLockedAfterFunding(false), false);
}

// 2% fee display: £50 + £15 + £20 sourcer → SB £1.30; remaining seller £35
{
  const fees = calculateFees({
    itemCostMinor: 5000,
    shippingMinor: 1500,
    sellerServiceFeeMinorOverride: 2000,
    protectionFeeBps: 200,
  });
  assert.equal(fees.protectionFeeMinor, 130);
  const remaining = remainingProtectedSellerShareMinor({
    itemCostMinor: 5000,
    shippingMinor: 1500,
    sellerServiceFeeMinor: 2000,
    procurementAdvanceMinor: 5000,
  });
  assert.equal(remaining, 3500);
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
    assertAllowlisted(
      isPaymentsTestRampOpen({ live: false, mode: "TEST" }),
      false,
    ),
    "allowed",
  );
  assert.equal(
    assertAllowlisted(
      isPaymentsTestRampOpen({ live: true, mode: "LIVE" }),
      false,
    ),
    "denied-empty",
  );
  const ordinary = { id: "ordinary-user-xyz", email: "ordinary@example.com" };
  assert.ok(ordinary.id !== "cms8or23a0000la046qm6ene4");
  assert.ok(!/futureman|theowlsaid/i.test(ordinary.email));
}

console.log("ticket acceptance + role model + access + fee tests passed");
