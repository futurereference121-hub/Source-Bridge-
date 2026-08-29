/**
 * Support messages must not show raw dispute/txn/ticket IDs or evidence dumps.
 * Concise PAYMENT TICKET ISSUE reference only.
 * Run: node scripts/test-dispute-context-human.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const copy = read("src/lib/payments/dispute-context-copy.ts");
const threads = read("src/lib/payments/admin-dispute-threads.ts");
const card = read("src/components/messaging/DisputeContextMessage.tsx");
const inbox = read("src/components/messaging/MessagesInbox.tsx");
const messenger = read("src/app/admin/reviews/admin-dispute-messenger.tsx");

assert.match(copy, /formatHumanDisputeContextBody/);
assert.match(copy, /PAYMENT TICKET ISSUE/);
assert.match(copy, /extractLegacyDisputeIds/);
assert.match(copy, /resolveDisputeContextDisplay/);
assert.match(copy, /formatDisputeAmountLabel/);
assert.doesNotMatch(
  copy,
  /Issue: \$\{/,
  "must not dump issue/category/reason into chat body",
);

assert.match(threads, /formatHumanDisputeContextBody/);
assert.match(threads, /buildDisputeContextStructured/);
assert.match(threads, /totalChargeMinor/);
assert.doesNotMatch(
  threads,
  /`dispute \$\{/,
  "must not embed raw dispute ids in primary body template",
);
assert.doesNotMatch(threads, /`txn \$\{/);
assert.doesNotMatch(threads, /`ticket \$\{/);
assert.doesNotMatch(
  threads,
  /category:\s*dispute\.category/,
  "must not pass dispute category into chat marker",
);
assert.doesNotMatch(
  threads,
  /reason:\s*dispute\.reason/,
  "must not pass dispute reason into chat marker",
);
assert.match(
  threads,
  /paymentTicketId:\s*ticketId/,
  "idempotent marker keyed by payment ticket when present",
);

assert.match(card, /PAYMENT TICKET ISSUE/);
assert.match(card, /View review/);
assert.match(card, /showReviewLink/);
assert.doesNotMatch(card, /Advanced \/ Audit/);
assert.doesNotMatch(card, /dispute-context-audit/);
assert.doesNotMatch(card, />Issue:</);

assert.match(inbox, /DisputeContextMessage/);
assert.match(inbox, /disputeContextInboxPreview/);
assert.doesNotMatch(
  inbox,
  /disputeCaseId:\s*\n?\s*activeConversation\?\.disputeCaseId/,
  "party inbox must not inject dispute IDs into support card",
);
assert.match(messenger, /DisputeContextMessage/);
assert.match(messenger, /showReviewLink/);

// Inline shape mirror of formatHumanDisputeContextBody (no tsx required)
function formatHumanDisputeContextBody(data) {
  return [
    "PAYMENT TICKET ISSUE",
    `Ticket: ${data.title}`,
    `Buyer: ${data.buyerHandle}`,
    `Sourcer: ${data.sellerHandle}`,
    `Amount: ${data.amountLabel}`,
    `Status: ${data.statusLabel}`,
  ].join("\n");
}
const body = formatHumanDisputeContextBody({
  title: "Sample deal",
  buyerHandle: "@buyer_a",
  sellerHandle: "@sourcer_b",
  amountLabel: "$0.54",
  statusLabel: "Under review",
});
assert.match(body, /^PAYMENT TICKET ISSUE\n/);
assert.match(body, /Ticket: Sample deal/);
assert.match(body, /Buyer: @buyer_a/);
assert.match(body, /Sourcer: @sourcer_b/);
assert.match(body, /Amount: \$0\.54/);
assert.match(body, /Status: Under review/);
assert.doesNotMatch(body, /WRONG_ITEM|disp_|txn_|tkt_|Issue:/);
assert.match(copy, /disputeContextInboxPreview[\s\S]*PAYMENT TICKET ISSUE/);

// Source must format amount via formatMinor / amountMinor — not hard-coded accounts
assert.match(copy, /formatMinor/);
assert.doesNotMatch(copy, /futureman|theowlsaid/i);
assert.doesNotMatch(threads, /futureman|theowlsaid/i);
assert.doesNotMatch(card, /futureman|theowlsaid/i);

console.log("[test-dispute-context-human] passed");
