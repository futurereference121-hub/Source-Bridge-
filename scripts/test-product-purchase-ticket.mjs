/**
 * Product Purchase Ticket — source assertions (no Stripe, no DB money).
 * Run: node scripts/test-product-purchase-ticket.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const helper = read("src/lib/payments/product-purchase-ticket.ts");
const checkout = read("src/lib/payments/checkout.ts");
const lifecycle = read("src/lib/payments/ticket-lifecycle.ts");
const card = read("src/components/messaging/PaymentTicketCard.tsx");
const purchases = read("src/app/admin/purchases/page.tsx");
const layout = read("src/app/admin/layout.tsx");
const productCheckout = read("src/app/api/payments/product-checkout/route.ts");

assert.match(helper, /ensureProductPurchaseTicket/);
assert.match(helper, /getOrCreateConversationPair/);
assert.match(helper, /PRODUCT_CHECKOUT/);
assert.match(helper, /isDirectPaymentOption/);
assert.match(helper, /Product Purchase Ticket/);
assert.match(checkout, /ensureProductPurchaseTicket/);
assert.match(lifecycle, /isProductPurchaseOrigin/);
assert.match(lifecycle, /if \(isProductPurchaseOrigin\(opts\.origin\)\) return false/);
assert.match(card, /Submit Shipping Proof/);
assert.match(card, /Product Purchase Ticket/);
assert.match(card, /Reveal shipping photo/);
assert.match(card, /Hide shipping photo/);
assert.match(card, /ticket-product-report-issue/);
assert.match(purchases, /Protected Purchases/);
assert.match(purchases, /protectedTxnId=\{t\.id\}/);
assert.match(purchases, /Safely refundable/);
assert.match(layout, /\/admin\/purchases/);
assert.match(productCheckout, /origin: "PRODUCT_CHECKOUT"/);
const fulfilment = read("src/lib/payments/fulfilment.ts");
assert.match(
  fulfilment,
  /if \(opts\.origin === "PRODUCT_CHECKOUT"\) return false/,
  "product purchase buyers cannot confirm receipt / release funds",
);
assert.match(
  fulfilment,
  /PRODUCT_ADMIN_ONLY/,
  "product purchase receipt decisions stay admin-controlled",
);
const tracking = read("src/app/api/payments/tracking/route.ts");
assert.match(tracking, /shipmentPhotoUrl: parsed\.data\.shipmentPhotoUrl/);
const tickets = read("src/lib/payments/tickets.ts");
assert.match(tickets, /shipmentPhotoUrl/);
assert.doesNotMatch(
  helper,
  /futureman|theowlsaid|bellahap/,
  "product purchase helper must stay account-independent",
);

console.log("[test-product-purchase-ticket] passed");
