/**
 * Audit: /api/payments/disputes PATCH must not create Stripe refunds.
 * Canonical money path: /api/admin/payments/issues PATCH.
 * Run: node scripts/test-refund-route-readonly.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const disputesRoute = fs.readFileSync(
  path.join(root, "src/app/api/payments/disputes/route.ts"),
  "utf8",
);
const issuesRoute = fs.readFileSync(
  path.join(root, "src/app/api/admin/payments/issues/route.ts"),
  "utf8",
);

assert.doesNotMatch(
  disputesRoute,
  /stripe\.refunds\.create/,
  "disputes PATCH must not call stripe.refunds.create",
);
assert.match(
  disputesRoute,
  /USE_ADMIN_ISSUES_ROUTE|admin\/payments\/issues/,
  "disputes PATCH must redirect refund attempts to admin issues route",
);
assert.match(
  issuesRoute,
  /executeAdminProtectedMoneyDecision|stripe\.refunds\.create|planProtectedRefund/,
  "admin issues route remains a refund writer (via shared decision)",
);
const protectedTxnRoute = fs.readFileSync(
  path.join(root, "src/app/api/admin/payments/protected-txns/route.ts"),
  "utf8",
);
assert.match(
  protectedTxnRoute,
  /executeAdminProtectedMoneyDecision/,
  "protected-txns no-dispute path shares the same money decision",
);
const shared = fs.readFileSync(
  path.join(root, "src/lib/payments/admin-protected-decision.ts"),
  "utf8",
);
assert.match(shared, /stripe\.refunds\.create/);
assert.match(shared, /payment_intent: working\.stripePaymentIntentId/);
assert.match(shared, /releaseFinal/);

console.log("test-refund-route-readonly: PASS");
