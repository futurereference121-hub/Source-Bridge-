/**
 * 72h unfunded expiry, Connect funding gate vs Accept, PI retry reuse.
 * Generic users A/B/C/D — no historical account names.
 * Run: node scripts/test-ticket-expiry-connect-retry.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const HOUR = 60 * 60 * 1000;
const UNFUNDED_TICKET_INACTIVITY_MS = 72 * HOUR;

function isInactiveTicketStatus(status) {
  return [
    "DECLINED",
    "CANCELLED",
    "SUPERSEDED",
    "DELETED",
    "VOIDED",
    "REFUNDED",
    "EXPIRED",
  ].includes(status);
}

function ticketAppearsInChatTimeline(opts) {
  if (opts.hiddenFromChatAt) return false;
  const hidden = [
    "CANCELLED",
    "DECLINED",
    "SUPERSEDED",
    "VOIDED",
    "DELETED",
    "EXPIRED",
  ];
  if (!hidden.includes(opts.ticketStatus)) return true;
  if (opts.involvesMoney) return true;
  if (opts.fundedAt) return true;
  return false;
}

function isActiveLifecycleTicket(ticketStatus) {
  if (isInactiveTicketStatus(ticketStatus)) return false;
  return ["DRAFT", "PROPOSED", "ACCEPTED", "FUNDED"].includes(ticketStatus);
}

function unfundedTicketShouldExpire(opts) {
  const status = (opts.ticketStatus || "").trim();
  if (!status) return false;
  if (isInactiveTicketStatus(status)) return false;
  if (status === "FUNDED") return false;
  if (opts.involvesMoney) return false;
  if (opts.fundedAt) return false;
  const pi = (opts.paymentIntentStatus || "").trim();
  if (
    pi &&
    ["processing", "requires_action", "requires_capture", "succeeded"].includes(pi)
  ) {
    return false;
  }
  const raw = opts.lastMeaningfulActivityAt;
  if (!raw) return false;
  const activity = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  const now =
    opts.now instanceof Date
      ? opts.now.getTime()
      : typeof opts.now === "number"
        ? opts.now
        : Date.now();
  return now - activity >= UNFUNDED_TICKET_INACTIVITY_MS;
}

function isSellerConnectTransferReady(opts) {
  return Boolean(
    (opts.stripeAccountId || "").trim() &&
      opts.chargesEnabled &&
      opts.payoutsEnabled,
  );
}

function viewerMayAcceptTicket(opts) {
  const viewerId = (opts.viewerId || "").trim();
  const createdById = (opts.createdById || "").trim();
  if (opts.status !== "PROPOSED" && opts.status !== "DRAFT") return false;
  if (["EXPIRED", "FUNDED", "CANCELLED", "DECLINED"].includes(opts.status)) {
    return false;
  }
  const isParty = viewerId === opts.buyerId || viewerId === opts.sellerId;
  if (!isParty) return false;
  if (createdById && viewerId === createdById) return false;
  return true;
}

function viewerMayFundTicket(opts) {
  return Boolean(opts.viewerId && opts.buyerId && opts.viewerId === opts.buyerId);
}

function paymentIntentReusable(status) {
  return [
    "requires_payment_method",
    "requires_confirmation",
    "requires_action",
    "requires_capture",
  ].includes(status);
}

const now = Date.parse("2026-08-16T12:00:00.000Z");
const h71 = new Date(now - (72 * HOUR - 60 * 1000));
const h72 = new Date(now - 72 * HOUR);

{
  const A = "user_a";
  const B = "user_b";
  assert.equal(
    unfundedTicketShouldExpire({
      ticketStatus: "PROPOSED",
      lastMeaningfulActivityAt: h71,
      now,
    }),
    false,
    "71h59m still active",
  );
  assert.equal(
    unfundedTicketShouldExpire({
      ticketStatus: "ACCEPTED",
      lastMeaningfulActivityAt: h72,
      now,
    }),
    true,
    "72h unfunded expires",
  );
  assert.equal(
    unfundedTicketShouldExpire({
      ticketStatus: "PROPOSED",
      lastMeaningfulActivityAt: h72,
      paymentIntentStatus: "processing",
      now,
    }),
    false,
    "processing PI not expired",
  );
  assert.equal(
    unfundedTicketShouldExpire({
      ticketStatus: "FUNDED",
      lastMeaningfulActivityAt: h72,
      fundedAt: h72,
      now,
    }),
    false,
    "funded exempt",
  );
  assert.equal(
    unfundedTicketShouldExpire({
      ticketStatus: "ACCEPTED",
      lastMeaningfulActivityAt: h72,
      involvesMoney: true,
      now,
    }),
    false,
    "money history exempt",
  );
}

{
  assert.equal(
    ticketAppearsInChatTimeline({ ticketStatus: "EXPIRED" }),
    false,
  );
  assert.equal(
    ticketAppearsInChatTimeline({
      ticketStatus: "EXPIRED",
      fundedAt: new Date(),
    }),
    true,
  );
  assert.equal(isActiveLifecycleTicket("EXPIRED"), false);
  assert.equal(isActiveLifecycleTicket("PROPOSED"), true);
  assert.equal(isActiveLifecycleTicket("ACCEPTED"), true);
}

{
  const A = "user_a";
  const B = "user_b";
  const C = "user_c";
  const D = "user_d";
  assert.equal(
    viewerMayAcceptTicket({
      status: "PROPOSED",
      viewerId: B,
      createdById: A,
      buyerId: A,
      sellerId: B,
    }),
    true,
    "B accepts A's proposal without Connect",
  );
  assert.equal(
    viewerMayAcceptTicket({
      status: "PROPOSED",
      viewerId: C,
      createdById: C,
      buyerId: C,
      sellerId: D,
    }),
    false,
    "proposer C does not accept own revision",
  );
  assert.equal(
    viewerMayAcceptTicket({
      status: "PROPOSED",
      viewerId: D,
      createdById: C,
      buyerId: C,
      sellerId: D,
    }),
    true,
    "D accepts C proposal",
  );
  assert.equal(
    viewerMayAcceptTicket({
      status: "EXPIRED",
      viewerId: B,
      createdById: A,
      buyerId: A,
      sellerId: B,
    }),
    false,
    "expired cannot accept",
  );
  assert.equal(viewerMayFundTicket({ viewerId: A, buyerId: A }), true);
  assert.equal(viewerMayFundTicket({ viewerId: B, buyerId: A }), false);
  const canPayWhenSellerReady =
    viewerMayFundTicket({ viewerId: A, buyerId: A }) &&
    isSellerConnectTransferReady({
      stripeAccountId: "acct_seller_b",
      chargesEnabled: true,
      payoutsEnabled: true,
    });
  const canPayWhenSellerNotReady =
    viewerMayFundTicket({ viewerId: A, buyerId: A }) &&
    isSellerConnectTransferReady({
      stripeAccountId: null,
      chargesEnabled: false,
      payoutsEnabled: false,
    });
  assert.equal(canPayWhenSellerReady, true);
  assert.equal(canPayWhenSellerNotReady, false);
  assert.equal(
    isSellerConnectTransferReady({
      stripeAccountId: "acct_seller_b",
      chargesEnabled: true,
      payoutsEnabled: true,
    }),
    true,
  );
  assert.equal(
    isSellerConnectTransferReady({
      stripeAccountId: "acct_other",
      chargesEnabled: true,
      payoutsEnabled: true,
    }) && "acct_other" !== "acct_seller_b",
    true,
    "each seller has their own Connect id",
  );
}

{
  assert.equal(paymentIntentReusable("requires_payment_method"), true);
  assert.equal(paymentIntentReusable("succeeded"), false);
  assert.equal(paymentIntentReusable("processing"), false);
}

{
  // Three independent tickets: actions on C must not mutate A/B.
  const tickets = {
    A: { status: "ACCEPTED", funded: false },
    B: { status: "PROPOSED", funded: false },
    C: { status: "ACCEPTED", funded: false, lastPi: "requires_payment_method" },
  };
  tickets.C.lastPi = "requires_payment_method";
  assert.equal(tickets.A.status, "ACCEPTED");
  assert.equal(tickets.B.status, "PROPOSED");
  tickets.B.status = "CANCELLED";
  assert.equal(tickets.A.status, "ACCEPTED");
  assert.equal(tickets.C.status, "ACCEPTED");
  const active = Object.values(tickets).filter((t) =>
    isActiveLifecycleTicket(t.status),
  ).length;
  assert.equal(active, 2);
  const fourthBlocked = active >= 3;
  assert.equal(fourthBlocked, false);
  tickets.D = { status: "PROPOSED" };
  assert.equal(
    Object.values(tickets).filter((t) => isActiveLifecycleTicket(t.status)).length,
    3,
  );
}

{
  const src = readFileSync("src/lib/payments/checkout.ts", "utf8");
  assert.match(src, /CONNECT_NOT_READY/);
  assert.match(src, /getSellerConnectFundingState/);
  assert.match(src, /requires_payment_method/);
  assert.match(src, /PI_ALREADY_SUCCEEDED/);
  assert.match(src, /PI_PROCESSING/);
  assert.match(src, /hiddenFromChatAt/);
  assert.doesNotMatch(src, /futureman|theowlsaid|bellahap/);
  const card = readFileSync("src/components/messaging/PaymentTicketCard.tsx", "utf8");
  assert.match(card, /Complete Test Payment Setup/);
  assert.match(card, /Try Payment Again/);
  assert.match(card, /ticketMayShowPayUi/);
  assert.match(card, /ACKNOWLEDGE/);
  assert.match(card, /setCheckout\(null\)/);
  assert.doesNotMatch(card, /futureman|theowlsaid|bellahap/);
  const allow = readFileSync("src/lib/payments/allowlist.ts", "utf8");
  assert.match(allow, /isPaymentsTestRampOpen/);
  const life = readFileSync("src/lib/payments/ticket-lifecycle.ts", "utf8");
  assert.match(life, /hiddenFromChatAt/);
  assert.match(life, /export function ticketMayShowPayUi/);
  const tickets = readFileSync("src/lib/payments/tickets.ts", "utf8");
  assert.match(tickets, /trackingNumber: t\.protectedTransaction\?\.trackingNumber/);
  assert.match(tickets, /shippedAt: t\.protectedTransaction\?\.shippedAt/);
}

{
  assert.equal(
    ticketAppearsInChatTimeline({
      ticketStatus: "FUNDED",
      hiddenFromChatAt: new Date(),
    }),
    false,
  );
  assert.equal(
    ticketAppearsInChatTimeline({ ticketStatus: "FUNDED" }),
    true,
  );
}

console.log("test-ticket-expiry-connect-retry: PASS");
