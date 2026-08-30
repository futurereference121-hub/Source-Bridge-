/**
 * Admin live queues exclude TEST sourcing when LIVE_PAYMENTS_ENABLED is on.
 * Listed-product rows stay in listed-purchase views. Source assertions only.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const helper = read("src/lib/payments/admin-live-queue.ts");
const payments = read("src/app/admin/payments/page.tsx");
const issues = read("src/app/api/admin/payments/issues/route.ts");
const reviews = read("src/app/admin/reviews/page.tsx");
const listed = read("src/app/admin/payments/listed-purchases-section.tsx");
const cleanup = read("scripts/_cleanup-chat-test-tickets.mjs");

assert.match(helper, /adminLiveQueueProtectedTxnWhere/);
assert.match(helper, /origin: "PRODUCT_CHECKOUT"/);
assert.match(helper, /stripeMode: "LIVE"/);
assert.match(helper, /isLivePaymentsEnabled/);
assert.match(helper, /adminLiveSourcingProtectedTxnWhere/);
assert.match(helper, /adminLiveQueueDisputeWhere/);

assert.match(payments, /adminLiveSourcingProtectedTxnWhere/);
assert.match(payments, /adminLiveQueueDisputeWhere/);
assert.match(payments, /String\(flags\.LIVE_PAYMENTS_ENABLED\)/);
assert.match(payments, /TEST sourcing history is hidden from this live queue/);

assert.match(issues, /adminLiveQueueDisputeWhere/);
assert.match(
  read("src/app/api/admin/payments/route.ts"),
  /adminLiveQueueProtectedTxnWhere/,
);
assert.match(
  issues,
  /adminLiveQueueDisputeWhere\(\{\s*in:\s*\["OPEN",\s*"UNDER_REVIEW"\]\s*\}\)/,
);

assert.match(reviews, /adminLiveQueueDisputeWhere/);

assert.match(
  listed,
  /where: \{ origin: "PRODUCT_CHECKOUT" \}/,
  "listed-product admin section must stay unfiltered by TEST/LIVE",
);

assert.match(cleanup, /PRODUCT_CHECKOUT/);
assert.match(cleanup, /KNOWN_LIVE_TXN/);
assert.match(cleanup, /stripeMode/);
assert.doesNotMatch(
  cleanup,
  /futureman|theowlsaid|bellahap/,
  "cleanup must not classify by QA usernames",
);
assert.match(cleanup, /hiddenFromChatAt/);
assert.match(cleanup, /message\.deleteMany/);

console.log("test-admin-live-queue: PASS");
