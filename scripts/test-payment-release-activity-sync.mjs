/**
 * Release mutations must bump activityVersion before notify, return canonical
 * ticket fields, and apply immediate local state (procurement + final release).
 * Source assertions — no Stripe / no DB money.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const releaseProc = read("src/app/api/payments/release-procurement/route.ts");
const confirmReceipt = read("src/app/api/payments/confirm-receipt/route.ts");
const release = read("src/lib/payments/release.ts");
const sync = read("src/lib/payments/ticket-mutation-sync.ts");
const notify = read("src/lib/payment-notifications.ts");
const card = read("src/components/messaging/PaymentTicketCard.tsx");
const fulfilment = read("src/lib/payments/fulfilment.ts");
const tracking = read("src/app/api/payments/tracking/route.ts");

// 1–3: payment success covered by test-checkout-reconcile; procurement + final here
assert.match(release, /afterProtectedTxnMoneyEvent/);
assert.match(release, /event: "PROCUREMENT_RELEASED"/);
assert.match(release, /event: "FINAL_RELEASED"/);
assert.match(sync, /syncProtectedTxnParticipantActivity/);
assert.match(sync, /lastMeaningfulActivityAt/);
assert.match(sync, /bumpConversationActivity/);

assert.match(releaseProc, /activityVersion/);
assert.match(releaseProc, /getPaymentTicket/);
assert.match(releaseProc, /ticket,/);
assert.match(releaseProc, /await releaseProcurement/);

assert.match(confirmReceipt, /activityVersion/);
assert.match(confirmReceipt, /getPaymentTicket/);
assert.match(confirmReceipt, /ticket,/);

assert.match(notify, /notifyProcurementReleased/);
assert.match(notify, /notifyFinalReleased/);
assert.match(notify, /dedupeKey: `pt-proc-released:/);
assert.match(notify, /dedupeKey: `pt-final-released:/);

// 4–6: transfer failure / idempotent / stale — release engine guards
assert.match(
  release,
  /existingAttempt\?\.status === "SUCCEEDED"/,
  "idempotent retry must not duplicate transfer",
);
assert.doesNotMatch(
  release.match(/catch \(err\) \{[\s\S]*?status: "FAILED"/)?.[0] || "",
  /releasedAt:\s*new Date\(\)/,
  "transfer failure must not mark released",
);

assert.match(card, /shouldApplyTicketUpdate/);
assert.match(card, /json\.ticket/);
assert.match(card, /onTicketUpdated\?\.\(nextLocal\)/);
assert.match(
  card,
  /decision === "RELEASE_NOW" && released/,
  "RELEASE_NOW must not stick on READY_TO_RELEASE after transfer",
);

// 7: shipping parity with tracking route
assert.match(tracking, /lastMeaningfulActivityAt/);
assert.match(sync, /lastMeaningfulActivityAt/);

// 8: dispute path unchanged but must not regress
assert.match(fulfilment, /notifyDisputeOpened/);
assert.match(fulfilment, /bumpConversationActivity/);

// 9: two-session sync — activityVersion returned for remote reconcile
assert.match(fulfilment, /activityVersion/);
assert.match(release, /activityVersion: participantSync\.activityVersion/);

assert.doesNotMatch(
  releaseProc,
  /futureman|theowlsaid|bellahap/,
  "release routes must stay account-independent",
);

console.log("[test-payment-release-activity-sync] tests 1–9 passed");
