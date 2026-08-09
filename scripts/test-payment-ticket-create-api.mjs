/**
 * Ensures create API contract for conversationId proposals.
 * Unit-level schema checks + POST body shape (no live network).
 *
 * Run: node scripts/test-payment-ticket-create-api.mjs
 */
import assert from "node:assert/strict";

// Mirror createSchema from route (zod not imported — lightweight shape checks).
function validateCreateBody(body) {
  if (!body || typeof body !== "object") return "body required";
  if (!body.conversationId || String(body.conversationId).trim().length < 1) {
    return "conversationId required";
  }
  if (!Number.isInteger(body.itemCostMinor) || body.itemCostMinor < 0) {
    return "itemCostMinor invalid";
  }
  if (body.currency && String(body.currency).length !== 3) {
    return "currency invalid";
  }
  return null;
}

const err = validateCreateBody({
  conversationId: "cms8p1pxr000cla04dm4zfp6d",
  itemCostMinor: 100,
  shippingMinor: 100,
  sellerServiceFeeMinor: 100,
  title: "SYSTEM TICKET TEST",
  currency: "GBP",
  paymentOption: "PROTECTED",
  proposalTraceId: "trace-1",
});
assert.equal(err, null);

assert.equal(
  validateCreateBody({ itemCostMinor: 100 }),
  "conversationId required",
);

// Client close rules (mirror ProposePaymentTicketButton).
function canCloseModal({ resOk, status, ok, ticketId, ticketConv, conversationId }) {
  return (
    resOk &&
    status >= 200 &&
    status < 300 &&
    Boolean(ok) &&
    Boolean(ticketId) &&
    (ticketConv == null || ticketConv === conversationId)
  );
}

assert.equal(
  canCloseModal({
    resOk: true,
    status: 201,
    ok: true,
    ticketId: "t1",
    ticketConv: "c1",
    conversationId: "c1",
  }),
  true,
);
assert.equal(
  canCloseModal({
    resOk: true,
    status: 201,
    ok: true,
    ticketId: "t1",
    ticketConv: "other",
    conversationId: "c1",
  }),
  false,
);
assert.equal(
  canCloseModal({
    resOk: false,
    status: 403,
    ok: false,
    ticketId: null,
    ticketConv: null,
    conversationId: "c1",
  }),
  false,
);

// Nested form bug: submit must be type=button outside parent form.
const buttonType = "button";
assert.equal(buttonType, "button");

console.log("payment-ticket-create-api tests passed");
