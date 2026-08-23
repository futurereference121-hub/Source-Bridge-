/**
 * Shipping mutation must bump activityVersion before notify, and return
 * canonical ticket fields so Confirm Item Received appears without refresh.
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

const tracking = read("src/app/api/payments/tracking/route.ts");
const card = read("src/components/messaging/PaymentTicketCard.tsx");
const notify = read("src/lib/payment-notifications.ts");

assert.match(tracking, /bumpConversationActivity/);
assert.match(tracking, /notifyShipmentUpdate/);
assert.match(tracking, /activityVersion/);
assert.match(tracking, /getPaymentTicket/);
assert.match(tracking, /lastMeaningfulActivityAt/);
assert.match(
  tracking,
  /await notifyShipmentUpdate/,
  "notification must await after activity bump (not fire-and-forget ahead of response)",
);
assert.doesNotMatch(
  tracking,
  /void import\([`'"]@\/lib\/payment-notifications/,
  "must not fire-and-forget notify before canonical response",
);
assert.match(
  tracking,
  /ticketId: linkedTicketId/,
  "shipment notify should deep-link ticket when known",
);

assert.match(card, /json\.ticket/);
assert.match(card, /shouldApplyTicketUpdate/);
assert.match(card, /onTicketUpdated\?\.\(nextLocal\)/);

assert.match(notify, /ticketId\?:/);
assert.match(notify, /\?ticket=/);

assert.doesNotMatch(
  tracking,
  /futureman|theowlsaid|bellahap/,
  "tracking route must stay account-independent",
);

console.log("[test-shipping-activity-sync] passed");
