/**
 * Step 5 — item-issue wording (no user-facing "payment issue").
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const notify = read("src/lib/payment-notifications.ts");
const fulfil = read("src/lib/payments/fulfilment.ts");
const card = read("src/components/messaging/PaymentTicketCard.tsx");
const adminIssues = read("src/app/api/admin/payments/issues/route.ts");

assert.match(
  notify,
  /The Buyer reported an issue with the item\./,
);
assert.match(notify, /Source Bridge is reviewing the issue\./);
assert.doesNotMatch(notify, /Buyer reported a payment issue/);
assert.doesNotMatch(
  notify,
  /title: "Payment issue resolved"/,
);
assert.match(
  fulfil,
  /status:\s*"UNDER_REVIEW"/,
  "report issue must open UNDER_REVIEW immediately",
);
assert.match(fulfil, /await notifyDisputeOpened/);
assert.match(fulfil, /bumpConversationActivity/);
assert.match(card, /The Buyer reported an issue with the item/);
assert.match(card, /UNDER REVIEW BY SOURCE BRIDGE/);
assert.match(
  adminIssues,
  /status:\s*\{\s*in:\s*\["OPEN",\s*"UNDER_REVIEW"\]\s*\}/,
  "admin queue must include immediately-reviewed cases",
);

console.log("test-item-issue-wording: PASS");
