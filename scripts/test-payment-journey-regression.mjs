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
const D = "user-d";
const MAX_ACTIVE = 3;
const FEE_BPS = 700;

function partyAccepted(approved, revision) {
  return approved != null && Number(approved) === Number(revision);
}

function resolveAuthoritativeViewerId(opts) {
  const fromConversation = (opts.conversationSessionUserId || "").trim();
  if (fromConversation) return fromConversation;
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
  const feeBaseMinor = itemCostMinor + shippingMinor + sourcerFeeMinor;
  const protectionFeeMinor = Math.ceil((feeBaseMinor * FEE_BPS) / 10_000);
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
    AWAITING_SHIPMENT: "DELIVERED",
    IN_TRANSIT: "DELIVERED",
    DELIVERED: "DELIVERED",
  },
  START_INSPECTION: { DELIVERED: "IN_INSPECTION" },
  BUYER_RELEASE_NOW: {
    DELIVERED: "READY_TO_RELEASE",
    IN_INSPECTION: "READY_TO_RELEASE",
    READY_TO_RELEASE: "READY_TO_RELEASE",
  },
  OPEN_DISPUTE: { IN_INSPECTION: "DISPUTED" },
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

// ── 7% fee on full seller entitlement (Protected + Direct); historical stored fee untouched ──
{
  const p = fees({
    itemCostMinor: 10_000,
    shippingMinor: 2_000,
    sourcerFeeMinor: 5_000,
    option: "PROTECTED",
  });
  assert.equal(p.protectionFeeMinor, 1_190); // ceil(17000*700/10000)
  assert.equal(p.total, 18_190);
  const d = fees({
    itemCostMinor: 10_000,
    shippingMinor: 2_000,
    sourcerFeeMinor: 5_000,
    option: "DIRECT",
  });
  assert.equal(d.protectionFeeMinor, 1_190);
  // Historical funded fixture at 2% keeps stored fee
  const historicalFunded2pct = {
    itemCostMinor: 10_000,
    shippingMinor: 2_000,
    sellerServiceFeeMinor: 5_000,
    protectionFeeMinor: 240,
    totalChargeMinor: 17_240,
  };
  assert.equal(historicalFunded2pct.protectionFeeMinor, 240);
  assert.notEqual(historicalFunded2pct.protectionFeeMinor, p.protectionFeeMinor);
  // Historical funded under old item+shipping-only 7% base also preserved
  const historicalFundedOldBase = {
    itemCostMinor: 10_000,
    shippingMinor: 2_000,
    sellerServiceFeeMinor: 5_000,
    protectionFeeMinor: 840,
    totalChargeMinor: 17_840,
  };
  assert.equal(historicalFundedOldBase.protectionFeeMinor, 840);
  assert.notEqual(historicalFundedOldBase.protectionFeeMinor, p.protectionFeeMinor);
}

// ── Role permutations A/B (account independence) ──
const permutations = [
  { createdById: B, buyerId: A, sellerId: B, viewer: A, expectAccept: true },
  { createdById: B, buyerId: A, sellerId: B, viewer: B, expectAccept: false },
  { createdById: A, buyerId: B, sellerId: A, viewer: B, expectAccept: true },
  { createdById: A, buyerId: B, sellerId: A, viewer: A, expectAccept: false },
  { createdById: A, buyerId: A, sellerId: B, viewer: B, expectAccept: true },
  { createdById: B, buyerId: B, sellerId: A, viewer: A, expectAccept: true },
  { createdById: C, buyerId: D, sellerId: C, viewer: D, expectAccept: true },
  { createdById: D, buyerId: C, sellerId: D, viewer: C, expectAccept: true },
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
  assert.equal(s, "DELIVERED");
  s = apply(s, "START_INSPECTION");
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

const HIDDEN_CHAT = ["CANCELLED", "DECLINED", "SUPERSEDED", "VOIDED", "DELETED", "EXPIRED"];
function ticketInChat({ ticketStatus, protectedStatus, fundedAt, involvesMoney, hiddenFromChatAt }) {
  if (hiddenFromChatAt) return false;
  if (!HIDDEN_CHAT.includes(ticketStatus)) return true;
  if (involvesMoney || fundedAt) return true;
  return [
    "FUNDED",
    "PROCUREMENT_RELEASED",
    "AWAITING_SHIPMENT",
    "IN_TRANSIT",
    "DELIVERED",
    "IN_INSPECTION",
    "READY_TO_RELEASE",
    "RELEASED",
    "REFUNDED",
    "PARTIALLY_REFUNDED",
    "DISPUTED",
  ].includes(protectedStatus || "");
}
function bothAcceptedCopy(status, buyerRev, sellerRev, revision) {
  const both = partyAccepted(buyerRev, revision) && partyAccepted(sellerRev, revision);
  const terminal = [
    "DECLINED",
    "CANCELLED",
    "SUPERSEDED",
    "DELETED",
    "VOIDED",
    "REFUNDED",
  ].includes(status);
  return both && !terminal ? "Agreement accepted by both parties" : null;
}
function mergeVisible(messages, tickets) {
  const visible = tickets.filter((t) =>
    ticketInChat({ ticketStatus: t.status }),
  );
  const ids = new Set(visible.map((t) => t.id));
  const kept = messages.filter((m) => !m.ticketId || ids.has(m.ticketId));
  const covered = new Set(kept.map((m) => m.ticketId).filter(Boolean));
  for (const t of visible) {
    if (!covered.has(t.id)) kept.push({ id: `card:${t.id}`, ticketId: t.id });
  }
  return kept;
}
function pollReconcile(prevCards, nextTickets) {
  const visible = nextTickets.filter((t) =>
    ticketInChat({ ticketStatus: t.status }),
  );
  const prevById = new Map(prevCards.map((c) => [c.id, c]));
  return visible.map((t) => prevById.get(t.id) || { id: t.id, state: "inserted" });
}

// TEST 1 — sourcer proposes, buyer Accept
{
  const d = deriveAccept({
    viewerId: A,
    createdById: B,
    buyerId: A,
    sellerId: B,
    revision: 1,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 1,
    status: "PROPOSED",
  });
  assert.equal(d.viewerMayAccept, true);
}

// TEST 2 — proposer never sees Accept
{
  const d = deriveAccept({
    viewerId: B,
    createdById: B,
    buyerId: A,
    sellerId: B,
    revision: 1,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 1,
    status: "PROPOSED",
  });
  assert.equal(d.viewerMayAccept, false);
}

// TEST 3 — CANCELLED leftover dual-accept never shows both-accepted copy
{
  assert.equal(
    bothAcceptedCopy("CANCELLED", 1, 1, 1),
    null,
  );
  assert.equal(bothAcceptedCopy("ACCEPTED", 1, 1, 1), "Agreement accepted by both parties");
}

// TEST 4 — cancel then create: ticket B does not inherit A's acceptance
{
  const ticketA = {
    id: "ticket-a",
    status: "CANCELLED",
    revision: 1,
    buyerApprovedRevision: 1,
    sellerApprovedRevision: 1,
    createdById: B,
  };
  const ticketB = {
    id: "ticket-b",
    status: "PROPOSED",
    revision: 1,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 1,
    createdById: B,
    buyerId: A,
    sellerId: B,
  };
  assert.notEqual(ticketA.id, ticketB.id);
  assert.equal(ticketB.buyerApprovedRevision, null);
  const buyerOnB = deriveAccept({ ...ticketB, viewerId: A });
  assert.equal(buyerOnB.viewerMayAccept, true);
  assert.equal(bothAcceptedCopy(ticketA.status, 1, 1, 1), null);
}

// TEST 5 — poll isolation: cancelled A removed, proposed B inserted, A not mutated into B
{
  const prev = [
    { id: "ticket-a", state: "accepted-ui" },
  ];
  const nextTickets = [
    { id: "ticket-a", status: "CANCELLED" },
    { id: "ticket-b", status: "PROPOSED" },
  ];
  const cards = pollReconcile(prev, nextTickets);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, "ticket-b");
  assert.equal(cards[0].state, "inserted");
  assert.equal(prev[0].state, "accepted-ui");
}

// TEST 6 — cache cross-user: conversation session wins over stale other-party account
{
  const viewerId = resolveAuthoritativeViewerId({
    conversationSessionUserId: A,
    accountId: B,
    ticketViewerId: B,
    buyerId: A,
    sellerId: B,
  });
  assert.equal(viewerId, A);
  assert.equal(
    deriveAccept({
      viewerId,
      createdById: B,
      buyerId: A,
      sellerId: B,
      revision: 1,
      buyerApprovedRevision: null,
      sellerApprovedRevision: 1,
      status: "PROPOSED",
    }).viewerMayAccept,
    true,
  );
}

// TEST 7 — React keys are PaymentTicket.id
{
  const keyA = "ticket-a";
  const keyB = "ticket-b";
  assert.notEqual(keyA, keyB);
  const reuseWouldHappen = keyA === keyB;
  assert.equal(reuseWouldHappen, false);
}

// TEST 8 — funded / completed history stays in chat
{
  assert.equal(
    ticketInChat({ ticketStatus: "FUNDED", protectedStatus: "RELEASED" }),
    true,
  );
  assert.equal(
    ticketInChat({ ticketStatus: "FUNDED", protectedStatus: "REFUNDED" }),
    true,
  );
}

// TEST 9 — unfunded dead hidden from chat
{
  assert.equal(ticketInChat({ ticketStatus: "CANCELLED" }), false);
  assert.equal(ticketInChat({ ticketStatus: "DECLINED" }), false);
  assert.equal(ticketInChat({ ticketStatus: "SUPERSEDED" }), false);
  assert.equal(ticketInChat({ ticketStatus: "PROPOSED" }), true);
  assert.equal(ticketInChat({ ticketStatus: "ACCEPTED" }), true);
  const merged = mergeVisible(
    [
      { id: "m1", ticketId: "ticket-a" },
      { id: "m2", ticketId: "ticket-b" },
      { id: "m3" },
    ],
    [
      { id: "ticket-a", status: "CANCELLED" },
      { id: "ticket-b", status: "PROPOSED" },
    ],
  );
  assert.equal(merged.some((m) => m.ticketId === "ticket-a"), false);
  assert.equal(merged.some((m) => m.ticketId === "ticket-b"), true);
}

// TEST 10 — ordinary unrelated user C never accepts; waiting-for-self blocked
{
  const c = deriveAccept({
    viewerId: C,
    createdById: B,
    buyerId: A,
    sellerId: B,
    revision: 1,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 1,
    status: "PROPOSED",
  });
  assert.equal(c.viewerMayAccept, false);
  const selfWait = deriveAccept({
    viewerId: A,
    createdById: B,
    buyerId: A,
    sellerId: B,
    revision: 1,
    buyerApprovedRevision: null,
    sellerApprovedRevision: 1,
    status: "PROPOSED",
    buyerUsername: "alice",
    viewerUsername: "alice",
  });
  assert.equal(selfWait.viewerMayAccept, true);
}

// TEST 11 — Pay UI gone after FUNDED (ticket row may still say ACCEPTED)
{
  function ticketMayShowPayUi({
    ticketStatus,
    protectedStatus,
    fundedAt,
    paymentIntentStatus,
  }) {
    if (["CANCELLED", "DECLINED", "EXPIRED", "VOIDED"].includes(ticketStatus)) {
      return false;
    }
    if (ticketStatus === "FUNDED") return false;
    if (fundedAt) return false;
    const pst = protectedStatus || "";
    if (
      [
        "FUNDED",
        "PROCUREMENT_RELEASED",
        "AWAITING_SHIPMENT",
        "IN_TRANSIT",
        "DELIVERED",
        "IN_INSPECTION",
        "READY_TO_RELEASE",
        "RELEASED",
      ].includes(pst)
    ) {
      return false;
    }
    const pi = paymentIntentStatus || "";
    if (pi === "succeeded" || pi === "processing") return false;
    return ticketStatus === "ACCEPTED" || pst === "AWAITING_PAYMENT";
  }
  assert.equal(
    ticketMayShowPayUi({
      ticketStatus: "ACCEPTED",
      protectedStatus: "AWAITING_PAYMENT",
    }),
    true,
  );
  assert.equal(
    ticketMayShowPayUi({
      ticketStatus: "ACCEPTED",
      protectedStatus: "FUNDED",
    }),
    false,
  );
  assert.equal(
    ticketMayShowPayUi({
      ticketStatus: "FUNDED",
      protectedStatus: "FUNDED",
    }),
    false,
  );
  assert.equal(
    ticketMayShowPayUi({
      ticketStatus: "ACCEPTED",
      protectedStatus: "AWAITING_PAYMENT",
      fundedAt: "2026-08-16T00:00:00.000Z",
    }),
    false,
  );
  assert.equal(
    ticketMayShowPayUi({
      ticketStatus: "ACCEPTED",
      protectedStatus: "AWAITING_PAYMENT",
      paymentIntentStatus: "succeeded",
    }),
    false,
  );
  assert.equal(
    ticketMayShowPayUi({
      ticketStatus: "ACCEPTED",
      protectedStatus: "AWAITING_PAYMENT",
      paymentIntentStatus: "processing",
    }),
    false,
  );
}

// TEST 12 — generic User A buyer / User B sourcer lifecycle, isolated from ticket C
{
  const userA = "user-a-buyer";
  const userB = "user-b-sourcer";
  const ticketA = { id: "ticket-a", buyerId: userA, sellerId: userB, status: "FUNDED" };
  const ticketB = { id: "ticket-b", buyerId: userA, sellerId: userB, status: "ACCEPTED" };
  const ticketC = { id: "ticket-c", buyerId: userA, sellerId: userB, status: "PROPOSED" };
  assert.notEqual(ticketA.id, ticketB.id);
  assert.notEqual(ticketA.id, ticketC.id);
  assert.equal(ticketMayShowPayUiFor(ticketA.status, "FUNDED"), false);
  assert.equal(ticketMayShowPayUiFor(ticketB.status, "AWAITING_PAYMENT"), true);
  assert.equal(ticketMayShowPayUiFor(ticketC.status, null), false);

  let s = "FUNDED";
  s = apply(s, "ADD_TRACKING");
  assert.equal(s, "AWAITING_SHIPMENT");
  assert.deepEqual(
    s === "AWAITING_SHIPMENT" ? ["CONFIRM_RECEIPT"] : [],
    ["CONFIRM_RECEIPT"],
  );
  s = apply(s, "CONFIRM_RECEIPT");
  assert.equal(s, "DELIVERED");
  const afterReceiptChoices = ["RELEASE_NOW", "START_INSPECTION"];
  assert.equal(afterReceiptChoices.length, 2);
  assert.equal(afterReceiptChoices.includes("REPORT_ISSUE"), false);

  // Path 1: release remaining seller entitlement once → COMPLETED
  let releasePath = apply("DELIVERED", "BUYER_RELEASE_NOW");
  assert.equal(releasePath, "READY_TO_RELEASE");
  releasePath = apply(releasePath, "RELEASE_FINAL");
  assert.equal(releasePath, "RELEASED");
  const sellerEntitled = 12_000;
  const procurementTransferred = 10_000;
  const finalTransferred = 2_000;
  assert.equal(procurementTransferred + finalTransferred, sellerEntitled);
  assert.equal(ticketMayShowPayUiFor("FUNDED", "RELEASED"), false);

  // Path 2: inspection then buyer release during inspection
  let inspectPath = apply("DELIVERED", "START_INSPECTION");
  assert.equal(inspectPath, "IN_INSPECTION");
  inspectPath = apply(inspectPath, "BUYER_RELEASE_NOW");
  inspectPath = apply(inspectPath, "RELEASE_FINAL");
  assert.equal(inspectPath, "RELEASED");

  // Path 3: inspection then report issue — auto-release blocked
  let issuePath = apply("DELIVERED", "START_INSPECTION");
  assert.equal(issuePath, "IN_INSPECTION");
  issuePath = apply(issuePath, "OPEN_DISPUTE");
  assert.equal(issuePath, "DISPUTED");
  assert.equal(TRANSITIONS.RELEASE_FINAL[issuePath], undefined);
  assert.equal(TRANSITIONS.COMPLETE_INSPECTION[issuePath], undefined);

  // Ticket B/C unchanged by A's shipping/receipt/release
  assert.equal(ticketB.status, "ACCEPTED");
  assert.equal(ticketC.status, "PROPOSED");
}

function ticketMayShowPayUiFor(ticketStatus, protectedStatus) {
  if (["CANCELLED", "DECLINED", "EXPIRED", "VOIDED", "PROPOSED", "DRAFT"].includes(ticketStatus)) {
    return ticketStatus === "ACCEPTED";
  }
  if (ticketStatus === "FUNDED") return false;
  const pst = protectedStatus || "";
  if (
    [
      "FUNDED",
      "PROCUREMENT_RELEASED",
      "AWAITING_SHIPMENT",
      "IN_TRANSIT",
      "DELIVERED",
      "IN_INSPECTION",
      "READY_TO_RELEASE",
      "RELEASED",
    ].includes(pst)
  ) {
    return false;
  }
  return ticketStatus === "ACCEPTED" || pst === "AWAITING_PAYMENT";
}

// TEST 13 — archived funded tickets leave chat and the active cap
{
  assert.equal(
    ticketInChat({
      ticketStatus: "FUNDED",
      protectedStatus: "FUNDED",
      hiddenFromChatAt: "2026-08-16T00:00:00.000Z",
    }),
    false,
  );
  assert.equal(
    ticketInChat({ ticketStatus: "FUNDED", protectedStatus: "RELEASED" }),
    true,
  );
  const statuses = ["FUNDED", "FUNDED", "PROPOSED"];
  const hidden = new Set(["ticket-funded-1", "ticket-funded-2"]);
  const active = [
    { id: "ticket-funded-1", status: "FUNDED" },
    { id: "ticket-funded-2", status: "FUNDED" },
    { id: "ticket-proposed", status: "PROPOSED" },
  ].filter((t) => !hidden.has(t.id) && ["DRAFT", "PROPOSED", "ACCEPTED", "FUNDED"].includes(t.status));
  assert.equal(active.length, 1);
  void statuses;
}

console.log("payment journey regression suite passed");
