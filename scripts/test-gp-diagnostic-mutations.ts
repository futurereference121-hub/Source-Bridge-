/**
 * Proves disabled diagnostic mutations cannot write.
 * Run: node --experimental-strip-types scripts/test-gp-diagnostic-mutations.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { disabledDiagnosticMutation } from "../src/lib/payments/payout-rail/preview-diagnostic-guard.ts";
import { runSandboxE2eRelease } from "../src/lib/payments/payout-rail/preview-sandbox-e2e.ts";
import { restorePreviewSandboxFixture } from "../src/lib/payments/payout-rail/preview-fixture-restore.ts";

let passed = 0;
function ok(name: string, cond: unknown) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`PASS ${name}`);
}

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const forbidden = [
  "releaseFinal",
  "retryDefinitiveQuoteRejection",
  "user.create",
  "protectedTransaction.create",
  "prisma",
  "gpFetch",
  'method: "POST"',
];

const files = [
  "../src/app/api/diagnostics/gp-preview-runtime/e2e/route.ts",
  "../src/app/api/diagnostics/gp-preview-runtime/restore/route.ts",
  "../src/lib/payments/payout-rail/preview-sandbox-e2e.ts",
  "../src/lib/payments/payout-rail/preview-fixture-restore.ts",
  "../src/lib/payments/payout-rail/preview-diagnostic-guard.ts",
];

for (const file of files) {
  const text = source(file);
  for (const token of forbidden) {
    ok(`${file} has no ${token}`, !text.includes(token));
  }
}
const guard = source("../src/lib/payments/payout-rail/preview-diagnostic-guard.ts");
ok("guard reports zero writes", guard.includes("stripe_writes: 0") && guard.includes("db_writes: 0"));

const e2e = await runSandboxE2eRelease();
const restore = await restorePreviewSandboxFixture();
ok("e2e refusal writes nothing", e2e.stripe_writes === 0 && e2e.db_writes === 0 && e2e.blocker === "diagnostic_mutation_disabled");
ok("restore refusal writes nothing", restore.stripe_writes === 0 && restore.db_writes === 0 && restore.action === "restore");
ok("guard refusal writes nothing", disabledDiagnosticMutation("e2e").stripe_writes === 0 && disabledDiagnosticMutation("e2e").db_writes === 0);

const e2eRoute = source("../src/app/api/diagnostics/gp-preview-runtime/e2e/route.ts");
const restoreRoute = source("../src/app/api/diagnostics/gp-preview-runtime/restore/route.ts");
ok("e2e route does not call the old release helper", !e2eRoute.includes("runSandboxE2eRelease"));
ok("restore route does not call the old restore helper", !restoreRoute.includes("restorePreviewSandboxFixture"));
ok("mutation routes use 410", e2eRoute.includes("status: 410") && restoreRoute.includes("status: 410"));

const verify = source("../src/app/api/diagnostics/gp-preview-runtime/fixture/verify/route.ts");
const fixture = source("../src/app/api/diagnostics/gp-preview-runtime/fixture/route.ts");
const discover = source("../src/app/api/diagnostics/gp-preview-runtime/discover/route.ts");
ok("read-only verify remains GET", verify.includes("export async function GET") && !verify.includes("export async function POST"));
ok("read-only fixture remains GET", fixture.includes("export async function GET") && !fixture.includes("export async function POST"));
ok("read-only discover remains GET", discover.includes("export async function GET") && !discover.includes("export async function POST"));

console.log(`\n${passed} passed`);
