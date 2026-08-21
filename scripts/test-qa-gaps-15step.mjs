/**
 * GAP coverage: hide/delete chat, admin protected decision without dispute,
 * shipping photo reveal/hide. Source + domain asserts (no Stripe money objects).
 * Run: node scripts/test-qa-gaps-15step.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

// --- GAP 1 ---
const schema = read("prisma/schema.prisma");
assert.match(schema, /model MessageHide/);
assert.match(schema, /shipmentPhotoUrl/);
const migration = read(
  "prisma/migrations/20260821193000_message_hide_shipment_photo/migration.sql",
);
assert.match(migration, /MessageHide/);
assert.match(migration, /shipmentPhotoUrl/);

const hideLib = read("src/lib/conversation-hide.ts");
assert.match(hideLib, /hideMessageForUser/);
assert.match(hideLib, /FINANCIAL_RECEIPT_PROTECTED/);
assert.match(hideLib, /messageVisibleToUserWhere/);

const activity = read("src/lib/conversation-activity.ts");
assert.match(
  activity,
  /conversationParticipant\.updateMany/,
  "bump must clear per-user hiddenAt so chats resurface",
);

const convRoute = read("src/app/api/conversations/[id]/route.ts");
assert.match(convRoute, /action: z\.enum\(\["hide", "delete", "unhide"\]\)/);
assert.match(convRoute, /messageVisibleToUserWhere/);

const inbox = read("src/components/messaging/MessagesInbox.tsx");
assert.match(inbox, /Hide chat/);
assert.match(inbox, /Delete chat/);
assert.match(inbox, /Delete for me/);
assert.doesNotMatch(
  inbox,
  />\s*HIDE\s*</,
  "must not show raw permanent HIDE text in header",
);

// --- GAP 2 financial safety (Protected fund = 0 transfer) ---
const checkout = read("src/lib/payments/checkout.ts");
assert.match(checkout, /KEEP_ALL_PROTECTED|transferOnFund:\s*false/);
assert.doesNotMatch(
  checkout,
  /origin === "PRODUCT_CHECKOUT"[\s\S]{0,200}transfer_data/,
);

const decision = read("src/lib/payments/admin-protected-decision.ts");
assert.match(decision, /executeAdminProtectedMoneyDecision/);
assert.match(decision, /idempotencyKey: `admin_refund_\$\{input\.idempotencyScope\}/);
assert.match(decision, /DIRECT_NOT_SUPPORTED/);
assert.match(decision, /userId: txn\.sellerId|releaseFinal/);

const noDisputeApi = read("src/app/api/admin/payments/protected-txns/route.ts");
assert.match(noDisputeApi, /confirmed: z\.literal\(true\)/);
assert.match(noDisputeApi, /OPEN_DISPUTE_EXISTS/);
assert.match(noDisputeApi, /ADMIN_PROTECTED_PURCHASE_DECISION/);
assert.doesNotMatch(
  noDisputeApi,
  /disputeId: z/,
  "no-dispute API must not require disputeId",
);

const purchases = read("src/app/admin/purchases/page.tsx");
assert.match(purchases, /protectedTxnId=\{t\.id\}/);
assert.match(purchases, /Safely refundable/);
assert.doesNotMatch(
  purchases,
  /Admin refund \/ release controls appear when a buyer reports/,
);

// Prefer reading breakdown source for fee distinctness
const breakdown = read("src/lib/payments/breakdown.ts");
assert.match(breakdown, /platformFeeMinor/);
assert.match(breakdown, /finalResidualMinor/);
assert.match(breakdown, /refundableMinor/);

// --- GAP 3 ---
const card = read("src/components/messaging/PaymentTicketCard.tsx");
assert.match(card, /Reveal shipping photo/i);
assert.match(card, /Hide shipping photo/i);
assert.match(card, /ticket-shipping-photo-lightbox/);
assert.match(card, /max-h-\[90vh\] max-w-\[90vw\]/);
assert.doesNotMatch(
  card,
  /shipmentPhotoUrl[\s\S]{0,80}target="_blank"/,
  "shipping photo must not navigate via raw URL",
);

const fulfilment = read("src/lib/payments/fulfilment.ts");
assert.match(
  fulfilment,
  /if \(opts\.origin === "PRODUCT_CHECKOUT"\) return false/,
);
assert.match(fulfilment, /PRODUCT_ADMIN_ONLY/);

console.log("[test-qa-gaps-15step] passed");
