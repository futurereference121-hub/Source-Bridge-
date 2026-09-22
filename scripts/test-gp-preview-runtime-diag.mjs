/**
 * Focused tests: GP Preview runtime diagnostic gates (offline, no network).
 * Run: node scripts/test-gp-preview-runtime-diag.mjs
 */

import assert from "node:assert/strict";
import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`PASS ${name}`);
}

const routePath = path.join(
  root,
  "src/app/api/diagnostics/gp-preview-runtime/route.ts",
);
const helperPath = path.join(
  root,
  "src/lib/payments/payout-rail/preview-runtime-diag.ts",
);
const routeSrc = fs.readFileSync(routePath, "utf8");
const helperSrc = fs.readFileSync(helperPath, "utf8");

ok("route is GET-only export", /export async function GET/.test(routeSrc));
ok("route has no POST export", !/export async function POST/.test(routeSrc));
ok("route returns 404 outside gate", /status: 404/.test(routeSrc));
ok(
  "route uses dedicated auth header",
  routeSrc.includes("GP_PREVIEW_RUNTIME_DIAG_HEADER") &&
    helperSrc.includes('x-gp-preview-runtime-diag-auth'),
);
ok("route uses runGpPreviewRuntimeDiag", routeSrc.includes("runGpPreviewRuntimeDiag"));
ok(
  "helper reuses probeFinancialAccountConfigured",
  helperSrc.includes("probeFinancialAccountConfigured"),
);
ok("helper reuses gpFetch", helperSrc.includes("gpFetch"));
ok(
  "helper records zero mutations",
  helperSrc.includes("stripe_objects_created: 0") &&
    helperSrc.includes("db_writes: 0"),
);
ok(
  "helper uses local webhook self-test only",
  helperSrc.includes("generateTestHeaderString") &&
    helperSrc.includes("constructEvent"),
);
ok(
  "sources do not embed live secret material",
  !/sk_live_[A-Za-z0-9]{8,}/.test(routeSrc + helperSrc) &&
    !/rk_live_[A-Za-z0-9]{8,}/.test(routeSrc + helperSrc),
);

// Mirror gate logic (must stay in sync with helper)
function isGateOpen(env) {
  if (String(env.VERCEL_ENV || "").trim() !== "preview") {
    return { open: false, reason: "not_preview" };
  }
  if (String(env.VERCEL_GIT_COMMIT_REF || "").trim() !== "global-payouts-pilot") {
    return { open: false, reason: "wrong_branch" };
  }
  const initiation = String(env.GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED || "")
    .trim()
    .toLowerCase();
  if (
    initiation === "true" ||
    initiation === "1" ||
    initiation === "yes" ||
    initiation === "on"
  ) {
    return { open: false, reason: "initiation_enabled" };
  }
  return { open: true };
}

function verifyAuth(headerValue, expectedSha256Hex) {
  const provided = String(headerValue || "").trim();
  if (!provided || !expectedSha256Hex || expectedSha256Hex.length !== 64) {
    return false;
  }
  const got = createHash("sha256").update(provided, "utf8").digest();
  const exp = Buffer.from(expectedSha256Hex, "hex");
  if (exp.length !== got.length) return false;
  return timingSafeEqual(got, exp);
}

ok(
  "gate closed on production",
  !isGateOpen({
    VERCEL_ENV: "production",
    VERCEL_GIT_COMMIT_REF: "global-payouts-pilot",
    GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED: "false",
  }).open,
);
ok(
  "gate closed on wrong branch",
  !isGateOpen({
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "main",
    GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED: "false",
  }).open,
);
ok(
  "gate closed when initiation enabled",
  !isGateOpen({
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "global-payouts-pilot",
    GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED: "true",
  }).open,
);
ok(
  "gate open on preview pilot with initiation false",
  isGateOpen({
    VERCEL_ENV: "preview",
    VERCEL_GIT_COMMIT_REF: "global-payouts-pilot",
    GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED: "false",
  }).open,
);

const token = "unit-test-one-time-token";
const hash = createHash("sha256").update(token, "utf8").digest("hex");
ok("auth rejects missing", !verifyAuth(null, hash));
ok("auth rejects wrong token", !verifyAuth("nope", hash));
ok("auth accepts matching token", verifyAuth(token, hash));

const hashMatch = helperSrc.match(
  /GP_PREVIEW_RUNTIME_DIAG_AUTH_SHA256\s*=\s*"([a-f0-9]{64})"/,
);
ok("helper embeds sha256 only (64 hex)", Boolean(hashMatch));
ok(
  "helper source requires preview + global-payouts-pilot",
  helperSrc.includes('!== "preview"') &&
    helperSrc.includes("global-payouts-pilot"),
);

console.log(`\n${passed} passed`);
