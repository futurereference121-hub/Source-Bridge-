/**
 * Offline checks for the Preview fixture restore route.
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

ok("restore route is POST only", /export async function POST/.test(route) && !/export async function GET/.test(route));
ok("restore reuses diagnostic gate and auth", route.includes("isGpPreviewRuntimeDiagGateOpen") && route.includes("verifyGpPreviewRuntimeDiagAuth"));
ok("restore does not parse a caller body", !route.includes("req.json") && !route.includes("searchParams"));
ok("restore disables cache", route.includes("no-store"));
ok("helper locks preview host hash", helper.includes('const PREVIEW_HOST_H8 = "bf232aa9"'));
ok("helper uses the synthetic identity", helper.includes('normalizeUsername("testingtesting")') && helper.includes("GP Sandbox Test User") && helper.includes("gp-testingtesting@example.invalid"));
ok("helper leaves password unset", helper.includes("passwordHash: null"));
ok("helper re-queries stripe before write", helper.includes("discoverSandboxFixture"));
ok("helper uses one transaction", helper.includes("prisma.$transaction"));
ok("helper does not call stripe writes", !helper.includes('method: "POST"') && helper.includes("stripe_writes: 0"));
ok("public discovery strips fixture ids", discovery.includes("const { fixtureIds: _ids, ...redacted } = full"));

console.log(`\n${passed} passed`);
