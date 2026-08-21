/**
 * Step 2 — client reconcile after Stripe confirm (no duplicate fund on webhook).
 * Source-level guards; no live Stripe money objects.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const checkout = read("src/lib/payments/checkout.ts");
const route = read("src/app/api/payments/checkout/route.ts");
const ui = read("src/components/payments/ProtectedPaymentCheckout.tsx");
const card = read("src/components/messaging/PaymentTicketCard.tsx");
const webhooks = read("src/lib/payments/stripe/webhooks.ts");

assert.match(
  checkout,
  /export async function reconcileTxnFundingFromStripe/,
  "server reconcile entrypoint required",
);
assert.match(
  checkout,
  /eventId:\s*`client_reconcile_\$\{/,
  "client reconcile must use stable idempotent event id",
);
assert.match(
  checkout,
  /idempotencyKey:\s*`charge_\$\{opts\.paymentIntentId\}`/,
  "ledger charge key must stay PI-scoped so webhook cannot double-credit",
);
assert.match(
  checkout,
  /bumpConversationActivity/,
  "FUNDED transition must bump activityVersion for soft-poll clients",
);
assert.match(
  checkout,
  /existing\.status === "succeeded"[\s\S]*markTxnFundedFromWebhook/,
  "checkout reuse path must reconcile succeeded PI instead of waiting forever",
);
assert.match(
  route,
  /reconcile:\s*z\.literal\(true\)/,
  "checkout POST must accept reconcile:true",
);
assert.match(
  route,
  /reconcileTxnFundingFromStripe/,
  "checkout route must call reconcile helper",
);
assert.match(
  ui,
  /reconcile:\s*true/,
  "checkout UI must POST reconcile after confirmPayment",
);
assert.match(ui, /PAYMENT PROCESSING/);
assert.match(ui, /data-testid="payment-processing-status"/);
assert.doesNotMatch(
  ui,
  /funding is webhook-only/,
  "stale webhook-only comment must not remain as product truth",
);
assert.match(card, /showPaymentProcessing/);
assert.match(card, /data-testid="ticket-payment-processing"/);
assert.match(
  card,
  /Payment processing/,
  "ticket card must show PAYMENT PROCESSING, not Make Payment, while PI in flight",
);
assert.match(
  checkout,
  /await notifyPaymentFunded/,
  "funded notification must complete on the same FUNDED transition (not fire-and-forget)",
);
assert.match(
  webhooks,
  /markTxnFundedFromWebhook/,
  "webhook still confirms via the same fund helper (idempotent)",
);

const notify = read("src/lib/payment-notifications.ts");
assert.match(
  notify,
  /pt-funded:\$\{opts\.protectedTxnId\}|product-purchased:\$\{opts\.protectedTxnId\}/,
  "funded notification dedupe is stable per protected txn",
);
assert.match(notify, /purchased your/);

console.log("test-checkout-reconcile: PASS");
