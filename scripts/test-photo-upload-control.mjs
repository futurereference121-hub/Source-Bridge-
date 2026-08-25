/**
 * Steps 9–10: shared AddPhotoControl + shipping photo persistence / admin VIEW PHOTO.
 * Source assertions only — no Stripe money objects.
 * Run: node scripts/test-photo-upload-control.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const addPhoto = read("src/components/media/AddPhotoControl.tsx");
const viewPhoto = read("src/components/media/ViewPhotoControl.tsx");
const adminPhoto = read("src/components/admin/AdminShipmentPhoto.tsx");
const card = read("src/components/messaging/PaymentTicketCard.tsx");
const sales = read("src/app/profile/sales/page.tsx");
const purchases = read("src/app/profile/purchases/page.tsx");
const tracking = read("src/app/api/payments/tracking/route.ts");
const adminDispute = read("src/app/admin/reviews/admin-dispute-messenger.tsx");
const adminPayments = read("src/app/admin/payments/page.tsx");
const listed = read("src/app/admin/payments/listed-purchases-section.tsx");

// Step 9 — shared control
assert.match(addPhoto, /TAKE A PHOTO/);
assert.match(addPhoto, /UPLOAD A PHOTO/);
assert.match(addPhoto, /Replace/);
assert.match(addPhoto, /Remove/);
assert.match(addPhoto, /onBusyChange/);
assert.match(addPhoto, /REPLACE PHOTO/);
assert.doesNotMatch(
  addPhoto,
  />\s*Choose File\s*</,
  "Choose File must not be visible primary UX copy",
);
assert.match(addPhoto, /className="sr-only"/);
assert.match(card, /AddPhotoControl/);
assert.match(card, /ADD SHIPPING PHOTO/);
assert.match(card, /ADD EVIDENCE PHOTO/);
assert.match(card, /onBusyChange=\{setPhotoBusy\}/);
assert.match(sales, /ADD SHIPPING PHOTO/);
assert.match(sales, /AddPhotoControl/);
assert.match(adminDispute, /AddPhotoControl/);
assert.match(adminDispute, /ADD EVIDENCE PHOTO/);
assert.doesNotMatch(
  adminDispute,
  /Attach photo/,
  "admin dispute messenger must use shared AddPhotoControl",
);

// Step 10 — persist together + admin/buyer viewers
assert.match(tracking, /shipmentPhotoUrl: z\.string\(\)\.trim\(\)\.url\(\)/);
assert.match(tracking, /SHIPMENT_PHOTO_REQUIRED/);
assert.match(
  tracking,
  /shipmentPhotoUrl: parsed\.data\.shipmentPhotoUrl/,
  "photo must persist on same ProtectedTransaction update as carrier/tracking",
);
assert.match(tracking, /trackingCarrier: parsed\.data\.carrier/);
assert.match(tracking, /trackingNumber: parsed\.data\.trackingNumber/);
assert.match(tracking, /bumpConversationActivity/);
assert.match(viewPhoto, /VIEW PHOTO/);
assert.match(adminPhoto, /ViewPhotoControl/);
assert.match(adminPayments, /AdminShipmentPhoto/);
assert.match(listed, /AdminShipmentPhoto/);
assert.match(purchases, /ViewPhotoControl/);
assert.match(sales, /ViewPhotoControl/);
assert.match(card, /Reveal shipping photo/);
assert.match(card, /ticket-shipping-photo-lightbox/);
assert.doesNotMatch(
  card,
  /shipmentPhotoUrl[\s\S]{0,80}target="_blank"/,
  "ticket shipping photo must not open raw URL",
);
assert.doesNotMatch(
  adminPayments,
  /shipmentPhotoUrl[\s\S]{0,80}target="_blank"/,
  "admin must not navigate via raw shipping photo URL",
);

console.log("[test-photo-upload-control] passed");
