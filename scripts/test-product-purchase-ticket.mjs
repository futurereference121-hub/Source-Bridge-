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
const purchasesRedirect = read("src/app/admin/purchases/page.tsx");
const listed = read("src/app/admin/payments/listed-purchases-section.tsx");
const layout = read("src/app/admin/layout.tsx");
const productCheckout = read("src/app/api/payments/product-checkout/route.ts");
const notify = read("src/lib/payment-notifications.ts");

assert.match(helper, /ensureProductPurchaseTicket/);
assert.match(helper, /getOrCreateConversationPair/);
assert.match(helper, /PRODUCT_CHECKOUT/);
assert.match(helper, /isDirectPaymentOption/);
assert.match(helper, /Product Purchase Ticket/);
assert.match(checkout, /ensureProductPurchaseTicket/);
assert.match(lifecycle, /isProductPurchaseOrigin/);
assert.match(lifecycle, /if \(isProductPurchaseOrigin\(opts\.origin\)\) return false/);
assert.match(
  lifecycle,
  /export function ticketAppearsInChatTimeline[\s\S]*isProductPurchaseOrigin\(opts\.origin\)\) return false/,
);
assert.match(card, /Submit Shipping Proof/);
assert.match(card, /Product Purchase Ticket/);
assert.match(card, /Reveal shipping photo/);
assert.match(card, /Hide shipping photo/);
assert.match(card, /ticket-product-report-issue/);
assert.match(card, /AddPhotoControl/);
assert.match(card, /ADD SHIPPING PHOTO/);
assert.match(card, /ADD EVIDENCE PHOTO/);
const addPhoto = read("src/components/media/AddPhotoControl.tsx");
assert.match(addPhoto, /Replace/);
assert.match(addPhoto, /TAKE A PHOTO/);
assert.match(purchasesRedirect, /redirect\("\/admin\/payments#listed-product-purchases"\)/);
assert.match(listed, /LISTED PRODUCT PURCHASE/);
assert.match(listed, /protectedTxnId=\{t\.id\}/);
assert.match(listed, /Safely refundable/);
assert.match(listed, /shipmentPhotoUrl/);
assert.match(listed, /AdminShipmentPhoto/);
const adminPhoto = read("src/components/admin/AdminShipmentPhoto.tsx");
assert.match(adminPhoto, /ViewPhotoControl/);
const viewPhoto = read("src/components/media/ViewPhotoControl.tsx");
assert.match(viewPhoto, /VIEW PHOTO/);
assert.match(viewPhoto, /-lightbox/);
assert.match(layout, /AdminNav/);
assert.match(productCheckout, /origin: "PRODUCT_CHECKOUT"/);
assert.match(notify, /\/profile\/sales/);
assert.match(notify, /\/profile\/purchases/);
assert.match(
  notify,
  /Open Sales & Fulfilment to fulfil the order/,
  "product purchase notifications deep-link sellers to Sales & Fulfilment",
);
const purchasesPage = read("src/app/profile/purchases/page.tsx");
const salesPage = read("src/app/profile/sales/page.tsx");
assert.match(purchasesPage, /Listed product purchase/);
assert.match(salesPage, /Listed product purchase/);
assert.match(purchasesPage, /not a sourcing Payment Ticket in Inbox/);
assert.match(salesPage, /not a sourcing Payment Ticket in Inbox/);
assert.doesNotMatch(
  purchasesPage,
  /origin === "CHAT_TICKET" \|\| o\.paymentTicketId/,
  "product purchase tickets must not be labeled as sourcing via paymentTicketId alone",
);
assert.doesNotMatch(
  salesPage,
  /origin === "CHAT_TICKET" \|\| o\.paymentTicketId/,
  "product purchase tickets must not be labeled as sourcing via paymentTicketId alone",
);
assert.match(purchasesPage, /o\.origin === "PRODUCT_CHECKOUT"/);
assert.match(salesPage, /o\.origin === "PRODUCT_CHECKOUT"/);
assert.match(purchasesPage, /shipmentPhotoUrl/);
assert.match(salesPage, /shipmentPhotoUrl/);
const fulfilmentMap = read("src/lib/payments/fulfilment.ts");
assert.match(
  fulfilmentMap,
  /shipmentPhotoUrl: t\.shipmentPhotoUrl/,
  "orders API must expose shipping proof for Purchases / Sales cards",
);
assert.match(
  fulfilmentMap,
  /if \(opts\.origin === "PRODUCT_CHECKOUT"\) return false/,
  "product purchase buyers cannot confirm receipt / release funds",
);
assert.match(
  fulfilmentMap,
  /PRODUCT_ADMIN_ONLY/,
  "product purchase receipt decisions stay admin-controlled",
);
const inbox = read("src/components/messaging/MessagesInbox.tsx");
assert.match(
  inbox,
  /visibleChatTickets/,
  "Inbox must filter tickets before rendering Payment Ticket cards",
);
assert.match(
  inbox,
  /origin: t\.origin \?\? null/,
  "Inbox timeline filter must pass origin so PRODUCT_CHECKOUT is excluded",
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
