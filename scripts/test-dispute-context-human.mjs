/**
 * Support messages must not show raw dispute/txn/ticket IDs as primary copy.
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
assert.match(copy, /SOURCE BRIDGE REVIEW/);
assert.match(copy, /extractLegacyDisputeIds/);
assert.match(copy, /resolveDisputeContextDisplay/);

assert.match(threads, /formatHumanDisputeContextBody/);
assert.match(threads, /buildDisputeContextStructured/);
assert.doesNotMatch(
  threads,
  /`dispute \$\{/,
  "must not embed raw dispute ids in primary body template",
);
assert.doesNotMatch(threads, /`txn \$\{/);
assert.doesNotMatch(threads, /`ticket \$\{/);

assert.match(card, /Advanced \/ Audit/);
assert.match(card, /View Review/);
assert.match(card, /dispute-context-audit/);
assert.match(inbox, /DisputeContextMessage/);
assert.match(inbox, /disputeContextInboxPreview/);
assert.match(messenger, /DisputeContextMessage/);

console.log("[test-dispute-context-human] passed");
