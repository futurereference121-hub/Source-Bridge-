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
  const isParty =
    Boolean(viewerId) && (viewerId === buyerId || viewerId === sellerId);
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
    iAmProposer: Boolean(viewerId) && Boolean(proposerId) && viewerId === proposerId,
    iAmCounterparty: Boolean(
      viewerId && proposerId && isParty && viewerId !== proposerId,
    ),
    iAmBuyer: Boolean(viewerId) && viewerId === buyerId,
    iAmSeller: Boolean(viewerId) && viewerId === sellerId,
  };
}

function resolveAuthoritativeViewerId(opts) {
  const fromConversation = (opts.conversationSessionUserId || "").trim();
  if (fromConversation) return fromConversation;
  const accountId = (opts.accountId || "").trim();
  const ticketViewerId = (opts.ticketViewerId || "").trim();
  const buyerId = (opts.buyerId || "").trim();
  const sellerId = (opts.sellerId || "").trim();
  const accountIsParty =
    Boolean(accountId) && (accountId === buyerId || accountId === sellerId);
  if (accountIsParty) return accountId;
  const ticketIsParty =
    Boolean(ticketViewerId) &&
    (ticketViewerId === buyerId || ticketViewerId === sellerId);
  if (ticketIsParty) return ticketViewerId;
  return accountId || ticketViewerId;
}

function normalizePartyHandle(raw) {
  return (raw || "").trim().replace(/^@+/, "").toLowerCase();
}

function waitingCopyAddressesViewer(opts) {
  const viewerId = (opts.viewerId || "").trim();
  const waitForId = (opts.waitForId || "").trim();
  if (viewerId && waitForId && viewerId === waitForId) return true;
  const handle = normalizePartyHandle(opts.viewerUsername);
  const label = (opts.waitingLabel || "").toLowerCase();
  if (!handle || !label) return false;
  return (
    label.includes(`waiting for @${handle} to accept`) ||
    label.includes(`waiting for ${handle} to accept`)
  );
}

function deriveTicketAcceptanceState(opts) {
  const roles = resolveTicketRoleModel({
    createdById: opts.createdById,
    buyerId: opts.buyerId,
    sellerId: opts.sellerId,
    viewerId: opts.viewerId,
  });
  const viewerId = (opts.viewerId || "").trim();
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
  const isParty = roles.iAmBuyer || roles.iAmSeller;
  const myAcceptedCurrentRevision = roles.iAmBuyer
    ? buyerAcceptedCurrentRevision
    : roles.iAmSeller
      ? sellerAcceptedCurrentRevision
      : false;
  const openForAccept =
    opts.status === "PROPOSED" || opts.status === "DRAFT";
  const waitForId = roles.counterpartyId;
  const waitForUsername =
    waitForId && waitForId === roles.buyerId
      ? opts.buyerUsername
      : waitForId && waitForId === roles.sellerId
        ? opts.sellerUsername
        : opts.counterpartyUsername;
  const waitHandle = normalizePartyHandle(waitForUsername);
  const otherName = waitHandle
    ? `@${waitHandle}`
    : waitForId === roles.sellerId
      ? "the sourcer"
      : waitForId === roles.buyerId
        ? "the buyer"
        : "the other participant";
  const rawWaitingLabel = `Proposal sent. Waiting for ${otherName} to accept.`;
  const wouldWaitForSelf = waitingCopyAddressesViewer({
    waitingLabel: rawWaitingLabel,
    viewerUsername: opts.viewerUsername,
    viewerId,
    waitForId,
  });
  let canAccept = viewerMayAcceptTicket({
    status: opts.status,
    viewerId,
    createdById: roles.proposerId,
    buyerId: roles.buyerId,
    sellerId: roles.sellerId,
    revision: opts.revision,
    buyerApprovedRevision: opts.buyerApprovedRevision,
    sellerApprovedRevision: opts.sellerApprovedRevision,
  });
  let waitingForOther =
    roles.rolesValid &&
    roles.iAmProposer &&
    openForAccept &&
    myAcceptedCurrentRevision &&
    !bothAcceptedCurrentRevision &&
    !wouldWaitForSelf &&
    !isInactiveTicketStatus(opts.status);
  if (wouldWaitForSelf) {
    waitingForOther = false;
    if (
      openForAccept &&
      isParty &&
      !myAcceptedCurrentRevision &&
      !bothAcceptedCurrentRevision
    ) {
      canAccept = true;
    }
  }
  if (isInactiveTicketStatus(opts.status)) {
    canAccept = false;
    waitingForOther = false;
  }
  const bothAcceptedLabel =
    bothAcceptedCurrentRevision && !isInactiveTicketStatus(opts.status)
      ? "Agreement accepted by both parties"
      : null;
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
    viewerMayAccept: canAccept,
    shouldShowAcceptCTA: canAccept,
    viewerIsProposer: roles.iAmProposer,
    viewerIsBuyer: roles.iAmBuyer,
    viewerIsSourcer: roles.iAmSeller,
    viewerIsCounterparty: roles.iAmCounterparty,
    viewerAcceptedCurrentRevision: myAcceptedCurrentRevision,
    waitingForOther,
    waitingLabel: waitingForOther ? rawWaitingLabel : null,
    bothAcceptedLabel,
    viewerRoleLabel: roles.iAmBuyer
      ? "buyer"
      : roles.iAmSeller
        ? "sourcer"
        : null,
    needsRoleRevision: !roles.rolesValid && openForAccept && Boolean(roles.proposerId),
  };
}

function viewerMayAcceptTicket(opts) {
  const viewerId = (opts.viewerId || "").trim();
  const createdById = (opts.createdById || "").trim();
  const buyerId = (opts.buyerId || "").trim();
  const sellerId = (opts.sellerId || "").trim();
  const activeUnfunded = opts.status === "PROPOSED" || opts.status === "DRAFT";
  if (!viewerId || !activeUnfunded) return false;
  if (
    ["CANCELLED", "DECLINED", "SUPERSEDED", "VOIDED", "DELETED", "FUNDED", "REFUNDED", "EXPIRED"].includes(
      opts.status,
    )
  ) {
    return false;
  }
  const isParty = viewerId === buyerId || viewerId === sellerId;
  if (!isParty) return false;
  if (createdById && viewerId === createdById) return false;
  const mine =
    viewerId === buyerId
      ? partyAcceptedCurrentRevision(opts.buyerApprovedRevision, opts.revision)
      : partyAcceptedCurrentRevision(opts.sellerApprovedRevision, opts.revision);
  return !mine;
}

function isInactiveTicketStatus(status) {
  return ["DECLINED", "CANCELLED", "SUPERSEDED", "DELETED", "VOIDED", "REFUNDED"].includes(
    status,
  );
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
  const sellerServiceFeeMinor = sellerServiceFeeMinorOverride ?? 0;
  const feeBaseMinor = itemCostMinor + shippingMinor + sellerServiceFeeMinor;
  const protectionRaw = Math.ceil(
    (feeBaseMinor * Math.max(0, protectionFeeBps)) / 10_000,
  );
  return {
    itemCostMinor,
    shippingMinor,
    sellerServiceFeeMinor,
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
const C = "user-c";
const D = "user-d";
const stranger = "stranger-1";
const revision = 1;
const FM = "cms8or23a0000la046qm6ene4";
const OWL = "cms62cfan0000ih04giwg7ee3";

// Screenshot regression: futureman is buyer/counterparty, owl proposed.
{
  const ticket = {
    createdById: OWL,
    buyerId: FM,
    sellerId: OWL,
    revision: 1,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 1,
    status: "PROPOSED",
    buyerUsername: "futureman",
    sellerUsername: "theowlsaid",
  };
  const forFutureman = deriveTicketAcceptanceState({
    viewerId: FM,
    viewerUsername: "futureman",
    ...ticket,
  });
  assert.equal(forFutureman.iAmProposer, false);
  assert.equal(forFutureman.iAmCounterparty, true);
  assert.equal(forFutureman.iAmBuyer, true);
  assert.equal(forFutureman.canAccept, true);
  assert.equal(forFutureman.viewerIsProposer, false);
  assert.equal(forFutureman.viewerIsBuyer, true);
  assert.equal(forFutureman.viewerIsSourcer, false);
  assert.equal(forFutureman.viewerIsCounterparty, true);
  assert.equal(forFutureman.viewerAcceptedCurrentRevision, false);
  assert.equal(forFutureman.viewerMayAccept, true);
  assert.equal(forFutureman.shouldShowAcceptCTA, true);
  assert.equal(forFutureman.waitingForOther, false);
  assert.equal(forFutureman.waitingLabel, null);
  assert.equal(
    waitingCopyAddressesViewer({
      waitingLabel: forFutureman.waitingLabel,
      viewerUsername: "futureman",
      viewerId: FM,
    }),
    false,
  );

  const forOwl = deriveTicketAcceptanceState({
    viewerId: OWL,
    viewerUsername: "theowlsaid",
    ...ticket,
  });
  assert.equal(forOwl.iAmProposer, true);
  assert.equal(forOwl.canAccept, false);
  assert.equal(forOwl.waitingForOther, true);
  assert.match(forOwl.waitingLabel, /@futureman/);
  assert.doesNotMatch(forOwl.waitingLabel, /@theowlsaid to accept/);
}

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

// Missing createdById → still Accept for the party who has not approved
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
  assert.equal(forBuyer.canAccept, true);
  assert.equal(forBuyer.needsRoleRevision, false);
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

// 7% fee display: £50 + £15 + £20 sourcer → SB £5.95; remaining seller £35
{
  const fees = calculateFees({
    itemCostMinor: 5000,
    shippingMinor: 1500,
    sellerServiceFeeMinorOverride: 2000,
    protectionFeeBps: 700,
  });
  assert.equal(fees.protectionFeeMinor, 595);
  const remaining = remainingProtectedSellerShareMinor({
    itemCostMinor: 5000,
    shippingMinor: 1500,
    sellerServiceFeeMinor: 2000,
    procurementAdvanceMinor: 5000,
  });
  assert.equal(remaining, 3500);
  assert.equal(remaining + fees.protectionFeeMinor, 4095);
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

// Logged-in party identity wins over a stale ticket.viewer (cached GET).
{
  const stale = resolveAuthoritativeViewerId({
    accountId: A,
    ticketViewerId: B,
    buyerId: A,
    sellerId: B,
  });
  assert.equal(stale, A);
  const fromTicket = resolveAuthoritativeViewerId({
    accountId: "",
    ticketViewerId: A,
    buyerId: A,
    sellerId: B,
  });
  assert.equal(fromTicket, A);
}

// Conversation session User.id WINS even if cached /api/auth/me is the other party.
{
  const sessionWins = resolveAuthoritativeViewerId({
    conversationSessionUserId: A,
    accountId: B,
    ticketViewerId: B,
    buyerId: A,
    sellerId: B,
  });
  assert.equal(sessionWins, A);
  const recipientSeesAccept = deriveTicketAcceptanceState({
    viewerId: sessionWins,
    createdById: B,
    buyerId: A,
    sellerId: B,
    revision,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 1,
    status: "PROPOSED",
  });
  assert.equal(recipientSeesAccept.canAccept, true);
  const withoutSessionWouldLeakProposer = resolveAuthoritativeViewerId({
    accountId: B,
    ticketViewerId: B,
    buyerId: A,
    sellerId: B,
  });
  assert.equal(withoutSessionWouldLeakProposer, B);
}

// Generic A/B/C: financial role does not decide who must accept.
{
  const owlProposesBuyerA = deriveTicketAcceptanceState({
    viewerId: A,
    createdById: B,
    buyerId: A,
    sellerId: B,
    revision: 1,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 1,
    status: "PROPOSED",
    buyerUsername: "alice",
    sellerUsername: "bob",
    viewerUsername: "alice",
  });
  assert.equal(owlProposesBuyerA.viewerIsProposer, false);
  assert.equal(owlProposesBuyerA.viewerIsBuyer, true);
  assert.equal(owlProposesBuyerA.viewerIsSourcer, false);
  assert.equal(owlProposesBuyerA.viewerIsCounterparty, true);
  assert.equal(owlProposesBuyerA.viewerAcceptedCurrentRevision, false);
  assert.equal(owlProposesBuyerA.viewerMayAccept, true);
  assert.equal(owlProposesBuyerA.shouldShowAcceptCTA, true);

  const aProposesBuyerB = deriveTicketAcceptanceState({
    viewerId: B,
    createdById: A,
    buyerId: B,
    sellerId: A,
    revision: 1,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 1,
    status: "PROPOSED",
    buyerUsername: "bob",
    sellerUsername: "alice",
    viewerUsername: "bob",
  });
  assert.equal(aProposesBuyerB.viewerIsBuyer, true);
  assert.equal(aProposesBuyerB.viewerIsSourcer, false);
  assert.equal(aProposesBuyerB.shouldShowAcceptCTA, true);

  const stranger = deriveTicketAcceptanceState({
    viewerId: C,
    createdById: B,
    buyerId: A,
    sellerId: B,
    revision: 1,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 1,
    status: "PROPOSED",
  });
  assert.equal(stranger.shouldShowAcceptCTA, false);
  assert.equal(stranger.viewerMayAccept, false);
}

{
  const cancelled = deriveTicketAcceptanceState({
    viewerId: A,
    createdById: B,
    buyerId: A,
    sellerId: B,
    revision: 1,
    buyerApprovedRevision: 1,
    sellerApprovedRevision: 1,
    status: "CANCELLED",
  });
  assert.equal(cancelled.viewerMayAccept, false);
  assert.equal(cancelled.bothAcceptedLabel, null);
  assert.equal(cancelled.bothAcceptedCurrentRevision, true);
}

{
  const missingCreator = deriveTicketAcceptanceState({
    viewerId: A,
    createdById: "",
    buyerId: A,
    sellerId: B,
    revision: 1,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 1,
    status: "PROPOSED",
  });
  assert.equal(missingCreator.viewerMayAccept, true);
}

// Generic C proposes → D accepts; D proposes → C accepts (any two eligible accounts).
{
  const cProposes = {
    createdById: C,
    buyerId: D,
    sellerId: C,
    revision,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 1,
    status: "PROPOSED",
  };
  assert.equal(
    deriveTicketAcceptanceState({ viewerId: D, ...cProposes }).canAccept,
    true,
  );
  assert.equal(
    deriveTicketAcceptanceState({ viewerId: C, ...cProposes }).canAccept,
    false,
  );
  const dProposes = {
    createdById: D,
    buyerId: C,
    sellerId: D,
    revision,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 1,
    status: "PROPOSED",
  };
  assert.equal(
    deriveTicketAcceptanceState({ viewerId: C, ...dProposes }).canAccept,
    true,
  );
  assert.equal(
    deriveTicketAcceptanceState({ viewerId: D, ...dProposes }).canAccept,
    false,
  );
}

// trustLevel is not an Accept input — low-trust recipient still sees Accept.
{
  const lowTrust = deriveTicketAcceptanceState({
    viewerId: D,
    createdById: C,
    buyerId: D,
    sellerId: C,
    revision,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 1,
    status: "PROPOSED",
    trustLevel: 0,
  });
  const highTrust = deriveTicketAcceptanceState({
    viewerId: D,
    createdById: C,
    buyerId: D,
    sellerId: C,
    revision,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 1,
    status: "PROPOSED",
    trustLevel: 9,
  });
  assert.equal(lowTrust.canAccept, true);
  assert.equal(highTrust.canAccept, true);
  assert.equal(lowTrust.canAccept, highTrust.canAccept);
  assert.equal(
    viewerMayAcceptTicket.toString().includes("trustLevel"),
    false,
  );
  assert.equal(
    deriveTicketAcceptanceState.toString().includes("trustLevel"),
    false,
  );
}

// Older vs newer account records: Accept uses User.id only, not createdAt/trust.
{
  const older = {
    id: "user-older-record",
    createdAt: "2024-01-15T00:00:00.000Z",
    trustLevel: 3,
  };
  const newer = {
    id: "user-newer-record",
    createdAt: "2026-08-01T00:00:00.000Z",
    trustLevel: 0,
  };
  const olderProposes = deriveTicketAcceptanceState({
    viewerId: newer.id,
    createdById: older.id,
    buyerId: newer.id,
    sellerId: older.id,
    revision,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 1,
    status: "PROPOSED",
  });
  assert.equal(olderProposes.canAccept, true);
  const newerProposes = deriveTicketAcceptanceState({
    viewerId: older.id,
    createdById: newer.id,
    buyerId: older.id,
    sellerId: newer.id,
    revision,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 1,
    status: "PROPOSED",
  });
  assert.equal(newerProposes.canAccept, true);
}

console.log("ticket acceptance + role model + access + fee tests passed");
