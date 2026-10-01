/**
 * The Sandbox diagnostic release entry point is permanently disabled.
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

ok("route refuses instead of releasing", route.includes("status: 410") && route.includes("disabledDiagnosticMutation"));
ok("route does not call release or corrected retry", !route.includes("releaseFinal") && !route.includes("retryDefinitiveQuoteRejection") && !route.includes("runSandboxE2eRelease"));
ok("helper does not create users, transactions, or payouts", !helper.includes("user.create") && !helper.includes("protectedTransaction.create") && !helper.includes("releaseFinal") && !helper.includes("prisma"));
ok("helper does not post to Stripe", !helper.includes('method: "POST"') && !helper.includes("gpFetch"));

console.log(`\n${passed} passed`);
