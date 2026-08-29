/**
 * Task 2 — Admin dispute message + Inbox simultaneous delivery.
 * Source-level; no live Stripe / no DB mutation.
 * Run: node scripts/test-admin-dispute-message-inbox.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const threads = read("src/lib/payments/admin-dispute-threads.ts");
const inbox = read("src/components/messaging/MessagesInbox.tsx");
const hide = read("src/lib/conversation-hide.ts");
const activity = read("src/lib/conversation-activity.ts");
const copy = read("src/lib/payments/dispute-context-copy.ts");
const card = read("src/components/messaging/DisputeContextMessage.tsx");
const pair = read("src/lib/conversation-pair.ts");

// A/B — persist → activity bump (resurface) → notify (not notify-first)
assert.match(threads, /bumpConversationActivity/);
assert.match(
  threads,
  /bumpConversationActivity[\s\S]*createNotification/,
  "A. activity must advance before notification",
);
assert.match(
  threads,
  /messageType:\s*"USER"/,
  "E. admin text is a normal USER message",
);
assert.match(threads, /ensureVisibleDisputeContextMarker/);
assert.match(threads, /deletedBeforeAt|getParticipantDeleteCutoff/);
assert.match(
  activity,
  /hiddenAt:\s*null/,
  "B. bump clears per-user hide so Inbox resurfaces",
);
assert.match(
  hide,
  /Never clears deletedBeforeAt|deletedBeforeAt/,
  "C. Delete cutoff preserved on resurface",
);

// Inbox softList on PAYMENT_DISPUTE (and MESSAGE) — same logical event path
assert.match(
  inbox,
  /PAYMENT_DISPUTE/,
  "A/B. Inbox must softList on admin dispute notifications",
);
assert.match(
  inbox,
  /n\.type === "MESSAGE"[\s\S]*PAYMENT_DISPUTE|PAYMENT_DISPUTE[\s\S]*MESSAGE/,
);

// D — human topic block, no raw IDs in primary body
assert.match(copy, /PAYMENT TICKET ISSUE/);
assert.match(copy, /formatHumanDisputeContextBody/);
assert.doesNotMatch(
  threads,
  /`dispute \$\{/,
  "H. must not embed raw dispute ids in primary body",
);
assert.doesNotMatch(threads, /`txn \$\{/);
assert.doesNotMatch(threads, /`ticket \$\{/);
assert.match(card, /DisputeContextMessage|PAYMENT TICKET ISSUE/);
assert.match(card, /View review/);
assert.doesNotMatch(card, /Advanced \/ Audit/);
assert.doesNotMatch(
  threads,
  /category:\s*dispute\.category/,
  "D. must not dump dispute category into support chat",
);

// F — two-way: party still a normal conversation participant (USER messages)
assert.match(threads, /ADMIN_DISPUTE_CONTEXT/);
assert.match(pair, /adminSupportThreadPairKey/);

// G — one canonical admin support conversation (pair key reuse)
assert.match(threads, /adminSupportThreadPairKey/);
assert.match(
  threads,
  /getOrCreateAdminDisputeThread/,
  "G. reuse getOrCreate — no uncontrolled duplicate chats",
);

// Topic once + fresh after delete cutoff
assert.match(
  threads,
  /ensureVisibleDisputeContextMarker/,
  "D. topic block ensured above new messages after delete",
);
assert.match(
  threads,
  /useExclusive|deletedBeforeAt|getParticipantDeleteCutoff/,
);

// No aggressive polling introduced in this path
assert.doesNotMatch(threads, /setInterval\s*\(/);
assert.match(inbox, /setInterval\(\(\) => void softList\(\), 8000\)/);

console.log("[test-admin-dispute-message-inbox] A–H source checks passed");
