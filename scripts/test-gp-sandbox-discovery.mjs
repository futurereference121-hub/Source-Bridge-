/**
 * Offline checks for the Preview Sandbox discovery route.
 * Run: node scripts/test-gp-sandbox-discovery.mjs
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const route = fs.readFileSync(
  path.join(root, "src/app/api/diagnostics/gp-preview-runtime/discover/route.ts"),
  "utf8",
);
const helper = fs.readFileSync(
  path.join(root, "src/lib/payments/payout-rail/preview-sandbox-discovery.ts"),
  "utf8",
);

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`PASS ${name}`);
}

function h8(value) {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 8);
}

ok("route is GET only", /export async function GET/.test(route) && !/export async function POST/.test(route));
ok("route reuses diagnostic gate and auth", route.includes("isGpPreviewRuntimeDiagGateOpen") && route.includes("verifyGpPreviewRuntimeDiagAuth"));
ok("route does not read caller ids", !route.includes("searchParams") && !route.includes("req.json"));
ok("route disables cache", route.includes("no-store"));
ok("helper hash matches historical h8", helper.includes('createHash("sha256").update(String(value || "")).digest("hex").slice(0, 8)'));
ok("helper hardcodes historical recipient match", helper.includes('const RECIPIENT_PREFIX = "acct_1UHaY"') && helper.includes('const RECIPIENT_H8 = "3525542e"'));
ok("helper hardcodes historical payout method match", helper.includes('const PAYOUT_METHOD_PREFIX = "thba_test_61"') && helper.includes('const PAYOUT_METHOD_H8 = "574fcb48"'));
ok("helper uses GET gpFetch and Stripe-Context", helper.includes('method: "GET"') && helper.includes("stripeContext: recipientId") && !helper.includes('method: "POST"'));
ok("helper uses existing readiness helper", helper.includes("pickReadyPayoutMethodId"));
ok("helper records zero writes", helper.includes("stripe_writes: 0") && helper.includes("db_writes: 0"));
ok("historical hash length is 8", h8("acct_1UHaYexample").length === 8);
ok("empty hash matches String(value || \"\")", h8("") === createHash("sha256").update("").digest("hex").slice(0, 8));

console.log(`\n${passed} passed`);
