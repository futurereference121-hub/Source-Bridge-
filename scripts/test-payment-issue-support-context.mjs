/**
 * Targeted: payment-issue support context cleanliness + product discoverability hooks.
 * Offline source checks. Run: node scripts/test-payment-issue-support-context.mjs
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
const notify = read("src/lib/payment-notifications.ts");
const activity = read("src/lib/conversation-activity.ts");
const productCheckout = read("src/app/api/payments/product-checkout/route.ts");
const fees = read("src/lib/payments/fees.ts");
const config = read("src/lib/payments/config.ts");
const createScript = read("scripts/_create-live-payment-test-product.mjs");

// Human-readable concise reference
assert.match(copy, /PAYMENT TICKET ISSUE/);
assert.match(copy, /Ticket: \$\{/);
assert.match(copy, /Buyer: \$\{/);
assert.match(copy, /Sourcer: \$\{/);
assert.match(copy, /Amount: \$\{/);
assert.match(copy, /Status: \$\{/);
assert.doesNotMatch(copy, /Issue: \$\{/);

// No technical dump into chat insert path
assert.doesNotMatch(threads, /category:\s*dispute\.category/);
assert.doesNotMatch(threads, /reason:\s*dispute\.reason/);
assert.doesNotMatch(threads, /details:/);
assert.match(threads, /ensureVisibleDisputeContextMarker/);
assert.match(threads, /bumpConversationActivity/);
assert.match(threads, /createNotification/);
assert.doesNotMatch(threads, /setInterval\s*\(/);

// Notification + activity path (no aggressive polling in dispute path)
assert.match(notify, /notifyDisputeOpened/);
assert.match(activity, /hiddenAt:\s*null/);
assert.match(inbox, /PAYMENT_DISPUTE/);
assert.match(inbox, /setInterval\(\(\) => void softList\(\), 8000\)/);

// Duplicate-ref: ticket-scoped idempotency
assert.match(threads, /paymentTicketId:\s*ticketId/);
assert.match(threads, /getParticipantDeleteCutoff/);

// Support USER messages still work
assert.match(threads, /messageType:\s*"USER"/);
assert.match(threads, /sendAdminDisputeMessage/);
assert.match(card, /showReviewLink/);

// Product fee model: listed checkout uses calculateFees + platform config (7%)
assert.match(productCheckout, /calculateFees/);
assert.match(productCheckout, /getPlatformPaymentConfig/);
assert.match(config, /SOURCE_BRIDGE_FEE_BPS\s*=\s*700/);
assert.match(fees, /roundBpsToMinor/);
assert.match(createScript, /LIVE Payment Test Product/);
assert.match(createScript, /protectionFeeBps !== 700/);
assert.match(createScript, /PRODUCT PURCHASE FEE MODEL MISMATCH/);
assert.doesNotMatch(createScript, /SOURCE_BRIDGE_FEE_BPS\s*=\s*200/);

// No QA account hard-coding in runtime app sources
assert.doesNotMatch(copy, /futureman|theowlsaid/i);
assert.doesNotMatch(threads, /futureman|theowlsaid/i);
assert.doesNotMatch(card, /futureman|theowlsaid/i);
assert.doesNotMatch(productCheckout, /futureman|theowlsaid/i);

console.log("[test-payment-issue-support-context] passed");
