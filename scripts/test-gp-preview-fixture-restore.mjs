/**
 * The diagnostic fixture restore entry point is permanently disabled.
 * Run: node scripts/test-gp-preview-fixture-restore.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const route = fs.readFileSync(
  path.join(root, "src/app/api/diagnostics/gp-preview-runtime/restore/route.ts"),
  "utf8",
);
const helper = fs.readFileSync(
  path.join(root, "src/lib/payments/payout-rail/preview-fixture-restore.ts"),
  "utf8",
);
const discovery = fs.readFileSync(
  path.join(root, "src/lib/payments/payout-rail/preview-sandbox-discovery.ts"),
  "utf8",
);

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`PASS ${name}`);
}

ok("restore route refuses instead of writing", route.includes("status: 410") && route.includes("disabledDiagnosticMutation"));
ok("restore route does not call the old helper", !route.includes("restorePreviewSandboxFixture"));
ok("helper does not create users or mappings", !helper.includes("user.create") && !helper.includes("prisma") && !helper.includes("gpFetch"));
ok("public discovery still strips fixture ids", discovery.includes("const { fixtureIds: _ids, ...redacted } = full"));

console.log(`\n${passed} passed`);
