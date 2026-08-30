/**
 * Buyer purchase order detail — retrieval, auth, IDs, display state (source/mocks).
 * Run: node scripts/test-buyer-purchase-detail.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const fulfilment = read("src/lib/payments/fulfilment.ts");
const ordersRoute = read("src/app/api/payments/orders/route.ts");
const detail = read("src/app/profile/purchases/[id]/page.tsx");
const purchases = read("src/app/profile/purchases/page.tsx");
const notify = read("src/lib/payment-notifications.ts");
const displayState = read("src/lib/payments/purchase-display-state.ts");

// TEST A — canonical ProtectedTransaction ID on list + detail + notifications
assert.match(purchases, /profile\/purchases\/\$\{o\.id\}/);
assert.match(detail, /txnId=\$\{encodeURIComponent\(txnId\)\}/);
assert.match(detail, /role=buyer/);
assert.match(notify, /productPurchaseHref\(opts\.protectedTxnId\)/);
assert.doesNotMatch(
  detail + purchases + notify,
  /ProductPurchase|productPurchaseId|paymentIntentId/,
  "routing must use ProtectedTransaction id only",
);

// TEST B — active purchase detail loads via dedicated fetch (not list-only)
assert.match(detail, /setDetailLoading\(true\)/);
assert.match(detail, /data\.order/);
assert.match(detail, /showLoading = !order/);
assert.doesNotMatch(
  detail,
  /error \|\| detailError \|\| !order/,
  "list/detail errors must not hide a loaded order",
);

// TEST C — refunded still viewable (no active-only filter in list/get)
assert.doesNotMatch(
  fulfilment,
  /status:\s*\{\s*notIn:[\s\S]*RELEASED[\s\S]*buyerId/,
);
assert.doesNotMatch(
  fulfilment,
  /where:[\s\S]*buyerId[\s\S]*not:\s*"RELEASED"/,
);

// TEST D — completed (RELEASED) remains in buyer history
assert.match(displayState, /status === "RELEASED"/);
assert.match(displayState, /phase: "COMPLETED"/);
assert.match(detail, /releasedAt/);
assert.match(detail, /Remaining protected/);

// TEST E — wrong user blocked (404, no existence leak)
assert.match(fulfilment, /expectedRole/);
assert.match(fulfilment, /Order not found/);
assert.match(fulfilment, /status: 404/);
assert.match(ordersRoute, /expectedRole: parsed\.data\.role/);

// TEST F — notification deep-link target
assert.match(notify, /\/profile\/purchases\/\$\{protectedTxnId\}/);

// TEST G — purchases card → same detail route
assert.match(purchases, /href=\{`\/profile\/purchases\/\$\{o\.id\}`\}/);
assert.match(detail, /useParams/);

// Canonical display state on detail
assert.match(detail, /displayState/);
assert.match(detail, /labels\.payment/);
assert.match(detail, /labels\.shipping/);
assert.match(detail, /counterparty/);
assert.match(detail, /protectionFeeMinor|platformFeeMinor/);
assert.match(detail, /ViewPhotoControl/);

assert.doesNotMatch(
  fulfilment + detail + purchases,
  /futureman|theowlsaid|cmtf9ief10001l104t4bcxmqv|\$1\.07/,
  "must stay account-independent",
);

console.log("[test-buyer-purchase-detail] passed");
