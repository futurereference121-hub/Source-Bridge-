/**
 * Offline checks for the Preview Sandbox E2E route.
 * Run: node scripts/test-gp-sandbox-e2e.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const route = fs.readFileSync(
  path.join(root, "src/app/api/diagnostics/gp-preview-runtime/e2e/route.ts"),
  "utf8",
);
const helper = fs.readFileSync(
  path.join(root, "src/lib/payments/payout-rail/preview-sandbox-e2e.ts"),
  "utf8",
);

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`PASS ${name}`);
}

ok("route is POST only", /export async function POST/.test(route) && !/export async function GET/.test(route));
ok("route reuses diagnostic gate and auth", route.includes("isGpPreviewRuntimeDiagGateOpen") && route.includes("verifyGpPreviewRuntimeDiagAuth"));
ok("route does not parse a caller body", !route.includes("req.json") && !route.includes("searchParams"));
ok("route disables cache", route.includes("no-store"));
ok("helper locks preview host", helper.includes('const PREVIEW_HOST_H8 = "bf232aa9"'));
ok("helper uses the labelled fixture", helper.includes("GP_SANDBOX_E2E_FIXTURE_v1"));
ok("helper uses a synthetic buyer", helper.includes("GP Sandbox Synthetic Buyer") && helper.includes("gp-sandbox-buyer@example.invalid") && helper.includes("passwordHash: null"));
ok("helper releases through releaseFinal", helper.includes("releaseFinal({ protectedTxnId: txn.id })"));
ok("helper does not post to Stripe itself", !helper.includes('method: "POST"'));
ok("helper does not change live initiation", !helper.includes("GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED="));
ok("helper keeps the global payouts rail", helper.includes('payoutRail: "STRIPE_GLOBAL_PAYOUTS"'));
ok("helper does not invent a charge id", helper.includes('stripeChargeId: ""') && helper.includes('stripePaymentIntentId: ""'));

console.log(`\n${passed} passed`);
