/**
 * Universal order status sync + buyer purchases access (mocks/source only).
 * Run: node scripts/test-order-status-sync.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function hasShippingEvidence(input) {
  return Boolean(
    input.shippedAt ||
      (input.trackingNumber && input.trackingNumber.trim()) ||
      (input.shipmentPhotoUrl && input.shipmentPhotoUrl.trim()),
  );
}

function derivePurchaseDisplayState(input) {
  const status = input.status;
  const shipped = hasShippingEvidence(input);
  if (status === "RELEASED" || input.releasedAt) {
    return { phase: "COMPLETED", shortLabel: "COMPLETED" };
  }
  if (status === "REFUNDED") {
    return { phase: "REFUNDED", shortLabel: "REFUNDED" };
  }
  if (input.openDispute || status === "DISPUTED") {
    return { phase: "UNDER_REVIEW", shortLabel: "UNDER REVIEW" };
  }
  if (status === "IN_TRANSIT") {
    return { phase: "IN_TRANSIT", shortLabel: "IN TRANSIT" };
  }
  if (
    shipped &&
    ["AWAITING_SHIPMENT", "FUNDED", "PROCUREMENT_RELEASED"].includes(status)
  ) {
    return {
      phase: "SHIPPED_AWAITING_BUYER",
      shortLabel: "SHIPPED — AWAITING BUYER CONFIRMATION",
    };
  }
  if (["FUNDED", "PROCUREMENT_RELEASED"].includes(status)) {
    return { phase: "AWAITING_SHIPMENT", shortLabel: "AWAITING SHIPMENT" };
  }
  return { phase: status, shortLabel: status.replace(/_/g, " ") };
}

function shouldApplyOrdersPayload(opts) {
  if (opts.requestSeq < opts.latestSeq) return false;
  if (opts.force) return true;
  if (!opts.hasAppliedOrders) return true;
  if (opts.incomingVersion < opts.appliedVersion) return false;
  if (opts.incomingVersion === opts.appliedVersion) return false;
  return true;
}

// TEST 1 — seller ships → SHIPPED display (not raw AWAITING_SHIPMENT)
{
  const shipped = derivePurchaseDisplayState({
    status: "AWAITING_SHIPMENT",
    shippedAt: new Date().toISOString(),
    trackingNumber: "1Z999",
    trackingCarrier: "UPS",
  });
  assert.equal(shipped.phase, "SHIPPED_AWAITING_BUYER");
  assert.match(shipped.shortLabel, /SHIPPED/);
  assert.match(shipped.shortLabel, /AWAITING BUYER/);
}

// TEST 5 — refund surfaces REFUNDED
{
  const refunded = derivePurchaseDisplayState({ status: "REFUNDED" });
  assert.equal(refunded.phase, "REFUNDED");
  assert.equal(refunded.shortLabel, "REFUNDED");
}

// TEST 6 — seller/admin release → COMPLETED
{
  const done = derivePurchaseDisplayState({
    status: "RELEASED",
    releasedAt: new Date().toISOString(),
  });
  assert.equal(done.phase, "COMPLETED");
}

// TEST 4 — stale response protection
assert.equal(
  shouldApplyOrdersPayload({
    requestSeq: 1,
    latestSeq: 2,
    incomingVersion: 200,
    appliedVersion: 100,
  }),
  false,
);
assert.equal(
  shouldApplyOrdersPayload({
    requestSeq: 2,
    latestSeq: 2,
    incomingVersion: 200,
    appliedVersion: 200,
    hasAppliedOrders: true,
  }),
  false,
);
assert.equal(
  shouldApplyOrdersPayload({
    requestSeq: 2,
    latestSeq: 2,
    incomingVersion: 200,
    appliedVersion: 200,
    hasAppliedOrders: false,
  }),
  true,
  "first buyer load must apply even when version unchanged",
);
assert.equal(
  shouldApplyOrdersPayload({
    requestSeq: 2,
    latestSeq: 2,
    incomingVersion: 300,
    appliedVersion: 200,
    hasAppliedOrders: true,
  }),
  true,
);

// Source wiring — canonical module + surfaces + sync + nav
const fulfilment = read("src/lib/payments/fulfilment.ts");
const sales = read("src/app/profile/sales/page.tsx");
const purchases = read("src/app/profile/purchases/page.tsx");
const ordersRoute = read("src/app/api/payments/orders/route.ts");
const tracking = read("src/app/api/payments/tracking/route.ts");
const hook = read("src/hooks/useProtectedOrders.ts");
const sync = read("src/lib/purchase-order-surface-sync.ts");
const mobileNav = read("src/components/layout/MobileNav.tsx");
const site = read("src/lib/site.ts");
const notify = read("src/lib/payment-notifications.ts");
const listed = read("src/app/admin/payments/listed-purchases-section.tsx");
const detail = read("src/app/profile/purchases/[id]/page.tsx");

assert.match(fulfilment, /derivePurchaseDisplayState/);
assert.match(fulfilment, /displayState/);

assert.match(sales, /displayState\?\.shortLabel/);
assert.match(sales, /useProtectedOrders/);
assert.match(sales, /publishOrderUpdate/);

assert.match(purchases, /useProtectedOrders/);
assert.match(purchases, /displayState/);
assert.match(purchases, /profile\/purchases\/\$\{o\.id\}/);

assert.match(ordersRoute, /sinceVersion/);
assert.match(ordersRoute, /ordersVersion/);
assert.match(ordersRoute, /unchanged/);

assert.match(tracking, /ordersVersion/);
assert.match(tracking, /order,/);

assert.match(hook, /ORDERS_SOFT_POLL_MS\s*=\s*2500/);
assert.match(hook, /subscribePurchaseOrderChanged/);
assert.match(hook, /shouldApplyOrdersPayload/);
assert.match(hook, /visibilityState/);

assert.match(sync, /PURCHASE_ORDER_CHANGED_EVENT/);
assert.match(sync, /emitPurchaseOrderChanged/);

const accountMenu = read("src/components/layout/AccountMenu.tsx");

assert.match(site, /Inbox.*\/inbox/);
assert.match(site, /Profile.*\/profile/);
assert.doesNotMatch(
  site,
  /Purchases.*profile\/purchases/,
  "Purchases must not be in mobile bottom nav",
);
assert.match(accountMenu, /Purchases.*profile\/purchases/);
assert.doesNotMatch(mobileNav, /ShoppingBag/);

assert.match(notify, /productPurchaseHref\(opts\.protectedTxnId\)/);
assert.match(notify, /notifyBuyerPaymentConfirmed/);
assert.match(notify, /notifyBuyerPurchaseRefunded/);
assert.match(notify, /Payment confirmed for/);

assert.match(listed, /derivePurchaseDisplayState/);
assert.match(detail, /profile\/purchases/);

assert.doesNotMatch(
  fulfilment + sales + purchases + hook,
  /futureman|theowlsaid|\$1\.07/,
  "must stay account-independent",
);

console.log("[test-order-status-sync] passed");
