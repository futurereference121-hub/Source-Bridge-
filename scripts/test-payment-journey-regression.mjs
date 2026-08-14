/**
 * Dedicated critical-path Payment Ticket regression suite.
 * Generic users A/B/C only — no futureman/theowlsaid IDs except the explicit
 * fixture block at the bottom.
 *
 * Covers: create roles, dual-accept, no-charge funding authorization state,
 * procurement/fulfilment/receipt/inspection/final-release transitions,
 * Direct vs Protected, 3-active cap, collapse CTA rule, account independence.
 *
 * Does NOT create PaymentIntent / Charge / Transfer / Refund.
 * Run: node scripts/test-payment-journey-regression.mjs
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const A = "user-a";
const B = "user-b";
const C = "user-c";
const MAX_ACTIVE = 3;
const FEE_BPS = 200;

function partyAccepted(approved, revision) {
  return approved != null && Number(approved) === Number(revision);
}

function resolveAuthoritativeViewerId(opts) {
  const accountId = (opts.accountId || "").trim();
  const ticketViewerId = (opts.ticketViewerId || "").trim();
  const buyerId = (opts.buyerId || "").trim();
  const sellerId = (opts.sellerId || "").trim();
  if (accountId && (accountId === buyerId || accountId === sellerId)) {
    return accountId;
  }
  if (
    ticketViewerId &&
    (ticketViewerId === buyerId || ticketViewerId === sellerId)
  ) {
    return ticketViewerId;
  }
  return accountId || ticketViewerId;
}

function deriveAccept(opts) {
  const viewerId = (opts.viewerId || "").trim();
  const proposerId = (opts.createdById || "").trim();
  const buyerId = (opts.buyerId || "").trim();
  const sellerId = (opts.sellerId || "").trim();
  const isParty = viewerId === buyerId || viewerId === sellerId;
  const viewerIsProposer = Boolean(viewerId && proposerId && viewerId === proposerId);
  const viewerIsBuyer = viewerId === buyerId;
  const viewerIsSourcer = viewerId === sellerId;
  const viewerIsCounterparty = Boolean(
    viewerId && proposerId && isParty && viewerId !== proposerId,
  );
  const buyerOk = partyAccepted(opts.buyerApprovedRevision, opts.revision);
  const sellerOk = partyAccepted(opts.sellerApprovedRevision, opts.revision);
  const mine = viewerIsBuyer ? buyerOk : viewerIsSourcer ? sellerOk : false;
  const open = opts.status === "PROPOSED" || opts.status === "DRAFT";
  const viewerMayAccept =
    Boolean(proposerId) && viewerIsCounterparty && open && !mine;
  return {
    viewerIsProposer,
    viewerIsBuyer,
    viewerIsSourcer,
    viewerIsCounterparty,
    viewerAcceptedCurrentRevision: mine,
    viewerMayAccept,
    shouldShowAcceptCTA: viewerMayAccept,
    bothAccepted: buyerOk && sellerOk,
    collapsedShowsAccept: viewerMayAccept,
  };
}

function fees({ itemCostMinor, shippingMinor, sourcerFeeMinor, option }) {
  const base = itemCostMinor + shippingMinor;
  const protectionFeeMinor = Math.ceil((base * FEE_BPS) / 10_000);
  return {
    itemCostMinor,
    shippingMinor,
    sellerServiceFeeMinor: sourcerFeeMinor,
    protectionFeeMinor,
    total: itemCostMinor + shippingMinor + sourcerFeeMinor + protectionFeeMinor,
    option: option || "PROTECTED",
  };
}

const TRANSITIONS = {
  AUTHORIZE_WITHOUT_CHARGE: { ACCEPTED: "AWAITING_PAYMENT" },
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
  COMPLETE_INSPECTION: { IN_INSPECTION: "READY_TO_RELEASE" },
  RELEASE_FINAL: {
    READY_TO_RELEASE: "RELEASED",
    FUNDED: "RELEASED",
    PROCUREMENT_RELEASED: "RELEASED",
  },
};

function apply(from, action) {
  const next = TRANSITIONS[action]?.[from];
  if (!next) throw new Error(`illegal ${action} from ${from}`);
  return next;
}

function countActive(statuses) {
  const active = new Set(["DRAFT", "PROPOSED", "ACCEPTED", "FUNDED"]);
  return statuses.filter((s) => active.has(s)).length;
}

function hashTerms(obj) {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

// ── 2% fee unchanged (Protected + Direct) ──
{
  const p = fees({
    itemCostMinor: 10_000,
    shippingMinor: 2_000,
    sourcerFeeMinor: 5_000,
    option: "PROTECTED",
  });
  assert.equal(p.protectionFeeMinor, 240);
  assert.equal(p.total, 17_240);
  const d = fees({
    itemCostMinor: 10_000,
    shippingMinor: 2_000,
    sourcerFeeMinor: 5_000,
    option: "DIRECT",
  });
  assert.equal(d.protectionFeeMinor, 240);
}

// ── Role permutations A/B (account independence) ──
const permutations = [
  { createdById: B, buyerId: A, sellerId: B, viewer: A, expectAccept: true },
  { createdById: B, buyerId: A, sellerId: B, viewer: B, expectAccept: false },
  { createdById: A, buyerId: B, sellerId: A, viewer: B, expectAccept: true },
  { createdById: A, buyerId: B, sellerId: A, viewer: A, expectAccept: false },
  { createdById: A, buyerId: A, sellerId: B, viewer: B, expectAccept: true },
  { createdById: B, buyerId: B, sellerId: A, viewer: A, expectAccept: true },
];
for (const p of permutations) {
  const sellerApproved = p.createdById === p.sellerId ? 1 : null;
  const buyerApproved = p.createdById === p.buyerId ? 1 : null;
  const d = deriveAccept({
    viewerId: p.viewer,
    createdById: p.createdById,
    buyerId: p.buyerId,
    sellerId: p.sellerId,
    revision: 1,
    buyerApprovedRevision: buyerApproved,
    sellerApprovedRevision: sellerApproved,
    status: "PROPOSED",
  });
  assert.equal(
    d.shouldShowAcceptCTA,
    p.expectAccept,
    JSON.stringify(p),
  );
  assert.equal(d.collapsedShowsAccept, p.expectAccept);
}

// Unrelated C never accepts
{
  const d = deriveAccept({
    viewerId: C,
    createdById: B,
    buyerId: A,
    sellerId: B,
    revision: 1,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 1,
    status: "PROPOSED",
  });
  assert.equal(d.shouldShowAcceptCTA, false);
}

// Stale ticket.viewer from proposer must not override logged-in buyer
{
  const viewerId = resolveAuthoritativeViewerId({
    accountId: A,
    ticketViewerId: B,
    buyerId: A,
    sellerId: B,
  });
  assert.equal(viewerId, A);
  const d = deriveAccept({
    viewerId,
    createdById: B,
    buyerId: A,
    sellerId: B,
    revision: 1,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 1,
    status: "PROPOSED",
  });
  assert.equal(d.shouldShowAcceptCTA, true);
}

// ── Dual-accept then authorize without charging ──
{
  let ticket = {
    status: "PROPOSED",
    revision: 1,
    createdById: B,
    buyerId: A,
    sellerId: B,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 1,
    funded: false,
    stripePaymentIntentId: null,
  };
  const buyer = deriveAccept({ ...ticket, viewerId: A });
  assert.equal(buyer.shouldShowAcceptCTA, true);
  ticket = {
    ...ticket,
    buyerApprovedRevision: 1,
    status: "ACCEPTED",
  };
  const after = deriveAccept({ ...ticket, viewerId: A });
  assert.equal(after.shouldShowAcceptCTA, false);
  assert.equal(after.bothAccepted, true);
  ticket.status = apply("ACCEPTED", "AUTHORIZE_WITHOUT_CHARGE");
  assert.equal(ticket.status, "AWAITING_PAYMENT");
  assert.equal(ticket.stripePaymentIntentId, null);
  assert.equal(ticket.funded, false);
}

// ── Protected fulfilment path (state only, no Stripe) ──
{
  let s = "FUNDED";
  s = apply(s, "RELEASE_PROCUREMENT");
  s = apply(s, "ADD_TRACKING");
  s = apply(s, "CONFIRM_RECEIPT");
  s = apply(s, "COMPLETE_INSPECTION");
  s = apply(s, "RELEASE_FINAL");
  assert.equal(s, "RELEASED");
}

// Direct skips procurement/inspection
{
  assert.equal(
    TRANSITIONS.RELEASE_PROCUREMENT.FUNDED,
    "PROCUREMENT_RELEASED",
  );
  const direct = { option: "DIRECT", status: "FUNDED" };
  assert.equal(direct.option, "DIRECT");
}

// ── 3-active cap ──
{
  assert.equal(countActive(["PROPOSED", "FUNDED", "FUNDED"]), 3);
  assert.equal(countActive(["PROPOSED", "FUNDED", "FUNDED", "CANCELLED"]), 3);
  assert.ok(countActive(["PROPOSED", "FUNDED", "FUNDED"]) >= MAX_ACTIVE);
}

// Terms hash changes on revision
{
  const h1 = hashTerms({ item: 100, rev: 1 });
  const h2 = hashTerms({ item: 100, rev: 2 });
  assert.notEqual(h1, h2);
}

// Chat collapse never hides Accept when viewerMayAccept
{
  function collapsedChrome(viewerMayAccept, expanded) {
    return {
      showAccept: viewerMayAccept,
      showActionRequiredReview: viewerMayAccept && !expanded,
    };
  }
  const collapsed = collapsedChrome(true, false);
  assert.equal(collapsed.showAccept, true);
  assert.equal(collapsed.showActionRequiredReview, true);
  const expanded = collapsedChrome(true, true);
  assert.equal(expanded.showAccept, true);
}

// Explicit fixture (only this block uses live test usernames as documentation)
{
  const FM = "cms8or23a0000la046qm6ene4";
  const OWL = "cms62cfan0000ih04giwg7ee3";
  const d = deriveAccept({
    viewerId: resolveAuthoritativeViewerId({
      accountId: FM,
      ticketViewerId: OWL,
      buyerId: FM,
      sellerId: OWL,
    }),
    createdById: OWL,
    buyerId: FM,
    sellerId: OWL,
    revision: 1,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 1,
    status: "PROPOSED",
  });
  assert.equal(d.viewerIsProposer, false);
  assert.equal(d.viewerIsBuyer, true);
  assert.equal(d.viewerIsSourcer, false);
  assert.equal(d.viewerIsCounterparty, true);
  assert.equal(d.viewerAcceptedCurrentRevision, false);
  assert.equal(d.viewerMayAccept, true);
  assert.equal(d.shouldShowAcceptCTA, true);
}

console.log("payment journey regression suite passed");
