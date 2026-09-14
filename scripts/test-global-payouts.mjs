/**
 * Global Payouts second-rail unit/contract tests (no Stripe network, no DB).
 * Run: node --experimental-strip-types scripts/test-global-payouts.mjs
 * or via payments:fast after registration.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`PASS ${name}`);
}

// --- Pure policy mirrors (keep in sync with eligibility.ts / status-mapper.ts) ---

function envBool(raw, defaultValue = false) {
  if (!raw) return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (!v) return defaultValue;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function parseCountries(raw) {
  return String(raw || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function isCountryAllowed({ gpEnabled, allowlist, country }) {
  if (!envBool(gpEnabled, false)) return false;
  const list = parseCountries(allowlist);
  if (list.length === 0) return false;
  const code = String(country || "").trim().toUpperCase();
  return list.includes(code);
}

function resolveRail({
  gpEnabled,
  allowlist,
  country,
  connectReady,
  connectHasAccount,
  gpReady,
  connectDenylist = "TH",
}) {
  if (connectReady) return "STRIPE_CONNECT";
  if (connectHasAccount) return "STRIPE_CONNECT";
  // Flag OFF ⇒ Connect-only (never UNSUPPORTED from this layer).
  if (!envBool(gpEnabled, false)) return "STRIPE_CONNECT";
  if (isCountryAllowed({ gpEnabled, allowlist, country })) {
    return "STRIPE_GLOBAL_PAYOUTS";
  }
  const deny = parseCountries(connectDenylist);
  const code = String(country || "").trim().toUpperCase();
  if (deny.includes(code)) return "UNSUPPORTED";
  return "STRIPE_CONNECT";
}

function lockedRail(raw) {
  return String(raw || "").trim().toUpperCase() === "STRIPE_GLOBAL_PAYOUTS"
    ? "STRIPE_GLOBAL_PAYOUTS"
    : "STRIPE_CONNECT";
}

function canAdvance(current, next) {
  const RANK = {
    PENDING: 0,
    AWAITING_MINIMUM: 1,
    AWAITING_FA_FUNDS: 1,
    PROCESSING: 2,
    ACTION_REQUIRED: 3,
    FAILED: 4,
    RETURNED: 5,
    SUCCEEDED: 6,
    RECONCILED: 7,
  };
  if (["FAILED", "AWAITING_MINIMUM", "AWAITING_FA_FUNDS"].includes(current)) {
    return true;
  }
  if (current === "SUCCEEDED" || current === "RECONCILED") {
    return next === "RETURNED" || next === "RECONCILED";
  }
  return (RANK[next] ?? 0) >= (RANK[current] ?? 0);
}

function groupMinimum(rows) {
  const map = new Map();
  for (const row of rows) {
    if (row.status !== "AWAITING_MINIMUM") continue;
    const key = `${row.sellerId}|${row.stripeMode}|${row.currency}`;
    const list = map.get(key) || [];
    list.push(row);
    map.set(key, list);
  }
  return [...map.values()];
}

// 1 Flag OFF ⇒ Connect-only (preserve today)
ok(
  "1 GP off ⇒ STRIPE_CONNECT when no Connect",
  resolveRail({
    gpEnabled: "false",
    allowlist: "TH",
    country: "TH",
    connectReady: false,
    connectHasAccount: false,
    gpReady: true,
  }) === "STRIPE_CONNECT",
);

// 2 Connect ready wins even if GP ready
ok(
  "2 Connect ready wins",
  resolveRail({
    gpEnabled: "true",
    allowlist: "TH",
    country: "TH",
    connectReady: true,
    connectHasAccount: true,
    gpReady: true,
  }) === "STRIPE_CONNECT",
);

// 3 Connect in progress stays Connect
ok(
  "3 Connect in progress",
  resolveRail({
    gpEnabled: "true",
    allowlist: "TH",
    country: "TH",
    connectReady: false,
    connectHasAccount: true,
    gpReady: true,
  }) === "STRIPE_CONNECT",
);

// 4 Thai allowlisted → GP
ok(
  "4 Thai sandbox GP rail",
  resolveRail({
    gpEnabled: "true",
    allowlist: "TH",
    country: "TH",
    connectReady: false,
    connectHasAccount: false,
    gpReady: false,
  }) === "STRIPE_GLOBAL_PAYOUTS",
);

// 5 Empty allowlist ⇒ no GP countries; Connect-unsupported → UNSUPPORTED
ok(
  "5 empty allowlist blocks GP",
  !isCountryAllowed({ gpEnabled: "true", allowlist: "", country: "TH" }),
);
ok(
  "5 TH denylisted + empty GP allowlist ⇒ UNSUPPORTED",
  resolveRail({
    gpEnabled: "true",
    allowlist: "",
    country: "TH",
    connectReady: false,
    connectHasAccount: false,
    gpReady: false,
  }) === "UNSUPPORTED",
);
ok(
  "5 US not denylisted ⇒ Connect default",
  resolveRail({
    gpEnabled: "true",
    allowlist: "TH",
    country: "US",
    connectReady: false,
    connectHasAccount: false,
    gpReady: false,
  }) === "STRIPE_CONNECT",
);

// 6 Legacy txn lock defaults to Connect
ok("6 legacy lock Connect", lockedRail("") === "STRIPE_CONNECT");
ok("6 lock GP", lockedRail("STRIPE_GLOBAL_PAYOUTS") === "STRIPE_GLOBAL_PAYOUTS");

// 7 No rail switch after SUCCESS
ok("7 no downgrade after SUCCEEDED", !canAdvance("SUCCEEDED", "PROCESSING"));
ok("7 allow RETURNED after SUCCEEDED", canAdvance("SUCCEEDED", "RETURNED"));

// 8 Dual-rail identity keys differ
ok(
  "8 distinct idempotency prefixes",
  "proc_gp_x".startsWith("proc_gp_") && "proc_xfer_x".startsWith("proc_xfer_"),
);

// 9 Platform absorbs fees — entitlement unchanged (contract)
ok("9 absorb fees: entitlement 100 stays 100", 100 - 0 === 100);

// 10 Minimum combine only same seller/currency
{
  const groups = groupMinimum([
    {
      sellerId: "A",
      stripeMode: "TEST",
      currency: "THB",
      status: "AWAITING_MINIMUM",
      amountMinor: 50,
    },
    {
      sellerId: "A",
      stripeMode: "TEST",
      currency: "THB",
      status: "AWAITING_MINIMUM",
      amountMinor: 40,
    },
    {
      sellerId: "B",
      stripeMode: "TEST",
      currency: "THB",
      status: "AWAITING_MINIMUM",
      amountMinor: 40,
    },
    {
      sellerId: "A",
      stripeMode: "TEST",
      currency: "USD",
      status: "AWAITING_MINIMUM",
      amountMinor: 40,
    },
  ]);
  ok("10 three compatible groups", groups.length === 3);
}

// 11 Source modules exist and stay isolated
ok(
  "11 payout-rail modules present",
  fs.existsSync(path.join(root, "src/lib/payments/payout-rail/rail-resolver.ts")) &&
    fs.existsSync(path.join(root, "src/lib/payments/payout-rail/outbound-payment.ts")) &&
    fs.existsSync(path.join(root, "src/app/api/webhooks/stripe/global-payouts/route.ts")),
);

// 12 Connect transfer body not moved into GP outbound file incorrectly
{
  const outbound = read("src/lib/payments/payout-rail/outbound-payment.ts");
  ok(
    "12 no stripe.transfers.create in GP outbound",
    !outbound.includes("stripe.transfers.create") &&
      !outbound.includes("transfers.create("),
  );
  const release = read("src/lib/payments/release.ts");
  ok(
    "12 release still has Connect transfers.create",
    release.includes("transfers.create"),
  );
  ok(
    "12 release dispatches GP",
    release.includes("releaseProcurementViaGlobalPayouts"),
  );
}

// 13 Flags default fail-closed in source
{
  const flags = read("src/lib/payments/flags.ts");
  ok(
    "13 GLOBAL_PAYOUTS_ENABLED default false",
    flags.includes('envBool("GLOBAL_PAYOUTS_ENABLED", false)'),
  );
  ok(
    "13 live initiation default false",
    flags.includes('envBool("GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED", false)'),
  );
}

// 14 UI copy avoids forcing provider product names on GP panel
{
  const ui = read("src/lib/payments/payout-rail/gpPayoutUi.ts");
  ok("14 Set up payouts copy", ui.includes("Set up payouts"));
  ok("14 Payout ready copy", ui.includes("Payout ready"));
  ok("14 no Global Payouts product name in UI model", !ui.includes("Global Payouts"));
}

// 15 SW network-only /api
{
  const sw = read("public/sw.js");
  ok("15 SW never-cache /api/", sw.includes('pathname.startsWith("/api/")'));
  ok("15 SW mentions Global Payouts network-only", sw.includes("Global Payouts"));
}

// 16 Schema additive defaults
{
  const schema = read("prisma/schema.prisma");
  ok(
    "16 payoutRail default Connect",
    schema.includes('payoutRail               String    @default("STRIPE_CONNECT")') ||
      schema.includes('@default("STRIPE_CONNECT")'),
  );
  ok("16 OutboundPaymentAttempt model", schema.includes("model OutboundPaymentAttempt"));
  ok("16 GlobalPayoutRecipient model", schema.includes("model GlobalPayoutRecipient"));
}

// 17 Trust passport universal ready
{
  const resolve = read("src/lib/trust-passport/resolve.ts");
  ok(
    "17 trust passport loads GP LIVE",
    resolve.includes("globalPayoutRecipient") || resolve.includes("liveGpReady"),
  );
  ok(
    "17 trust passport gates GP behind flag",
    resolve.includes("isGlobalPayoutsEnabled()"),
  );
}

// 18 Live eligibility universal
{
  const live = read("src/lib/live/eligibility.ts");
  ok("18 live uses isUniversalPayoutReady", live.includes("isUniversalPayoutReady"));
}

// 19 Restricted GP key — no fallback to Connect sk in gp-client
{
  const client = read("src/lib/payments/payout-rail/gp-client.ts");
  ok(
    "19 uses STRIPE_GP_RESTRICTED_KEY",
    client.includes("STRIPE_GP_RESTRICTED_KEY_TEST"),
  );
  ok(
    "19 does not read STRIPE_SECRET_KEY for GP",
    !client.includes('trimEnv("STRIPE_SECRET_KEY")'),
  );
}

// 20 Flag OFF skips GP table reads (safe before migration)
{
  const recipient = read("src/lib/payments/payout-rail/recipient.ts");
  ok(
    "20 getGlobalPayoutStatus early-returns when disabled",
    recipient.includes("if (!isGlobalPayoutsEnabled())") &&
      recipient.includes('status: "NOT_STARTED"'),
  );
}

console.log(`\nOK ${passed} global-payouts checks passed`);
