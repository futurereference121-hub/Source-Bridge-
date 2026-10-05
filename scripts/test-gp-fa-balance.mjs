/**
 * Pure Financial Account balance interpretation for API 2026-08-26.preview.
 * No network and no Production credentials.
 *
 * Run: node scripts/test-gp-fa-balance.mjs
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

if (process.env.SB_GP_FA_BALANCE_TEST !== "1") {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/SECRET|TOKEN|KEY|DATABASE|POSTGRES|NEON|STRIPE|PASSWORD|COOKIE|AUTH/i.test(key)) {
      delete env[key];
    }
  }
  env.SB_GP_FA_BALANCE_TEST = "1";
  env.NODE_ENV = "test";
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--import",
      pathToFileURL(path.join(here, "gp-sandbox-ticket-loader.mjs")).href,
      fileURLToPath(import.meta.url),
    ],
    { cwd: root, env, stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}

const { interpretFinancialAccountBalance } = await import(
  "../src/lib/payments/payout-rail/fa-funding.ts"
);

const FA = "fa_test_sandbox_gb";
let passed = 0;

function assert(cond, message) {
  if (!cond) throw new Error(message);
  passed += 1;
}

function read(body, currency, extra = {}) {
  return interpretFinancialAccountBalance({
    body,
    currency,
    configuredAccountId: FA,
    mode: "TEST",
    httpOk: true,
    httpStatus: 200,
    ...extra,
  });
}

function account(available, extra = {}) {
  return {
    id: FA,
    object: "v2.money_management.financial_account",
    livemode: false,
    ...extra,
    balance: { available },
  };
}

{
  const snap = read(
    account({
      gbp: { value: 4262, currency: "gbp" },
      usd: { value: 1, currency: "usd" },
    }),
    "GBP",
  );
  assert(snap.rawOk && snap.availableMinor === 4262 && snap.currency === "gbp", "documented GBP map");
  assert(snap.livemode === false && snap.failureKind == null, "documented GBP mode");
  assert(!JSON.stringify(snap).includes("usd"), "other currency is not selected");
}

{
  const snap = read(account({ usd: { value: 800, currency: "usd" } }), "usd");
  assert(snap.rawOk && snap.availableMinor === 800 && snap.currency === "usd", "requested USD map");
}

{
  const snap = read(account({ usd: { value: 800, currency: "usd" } }), "gbp");
  assert(!snap.rawOk && snap.failureKind === "missing_currency", "missing payout currency");
  assert(snap.availableMinor == null, "missing currency has no amount");
}

{
  const snap = read(account({ gbp: { value: 4262, currency: "usd" } }), "gbp");
  assert(!snap.rawOk && snap.failureKind === "missing_currency", "mismatched returned currency");
}

{
  const fractional = read(account({ gbp: { value: 10.5, currency: "gbp" } }), "gbp");
  const negative = read(account({ gbp: { value: -1, currency: "gbp" } }), "gbp");
  const text = read(account({ gbp: { value: "4262", currency: "gbp" } }), "gbp");
  const huge = read(account({ gbp: { value: Number.MAX_SAFE_INTEGER + 1, currency: "gbp" } }), "gbp");
  assert(fractional.failureKind === "malformed_amount", "fractional amount");
  assert(negative.failureKind === "malformed_amount", "negative amount");
  assert(text.failureKind === "malformed_amount", "string amount");
  assert(huge.failureKind === "malformed_amount", "unsafe integer");
}

{
  const zero = read(account({ gbp: { value: 0, currency: "gbp" } }), "gbp");
  assert(zero.rawOk && zero.availableMinor === 0, "zero is a valid available amount");
}

{
  const snap = interpretFinancialAccountBalance({
    body: {
      error: {
        type: "invalid_request_error",
        code: "account_invalid",
        message: "sk_test_should_not_leak fa_secret",
      },
    },
    currency: "gbp",
    configuredAccountId: FA,
    mode: "TEST",
    httpOk: false,
    httpStatus: 403,
  });
  assert(snap.failureKind === "http" && snap.httpStatus === 403, "unsuccessful GET");
  assert(snap.errorCode === "account_invalid" && snap.errorType === "invalid_request_error", "safe error metadata");
  assert(!JSON.stringify(snap).includes("sk_test_") && !JSON.stringify(snap).includes("fa_secret"), "raw error text omitted");
  assert(snap.availableMinor == null, "failed GET has no amount");
}

{
  const mismatch = read(account({ gbp: { value: 4262, currency: "gbp" } }, { id: "fa_other" }), "gbp");
  assert(mismatch.failureKind === "account_mismatch", "account mismatch");
  const live = read(account({ gbp: { value: 4262, currency: "gbp" } }, { livemode: true }), "gbp");
  assert(live.failureKind === "mode_mismatch" && live.livemode === true, "mode mismatch");
}

console.log(`gp fa balance: ${passed} passed`);
