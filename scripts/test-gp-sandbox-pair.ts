/**
 * Production Global Payouts Sandbox pair gate. No Stripe and no database.
 * Run: node --experimental-strip-types scripts/test-gp-sandbox-pair.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertSandboxCommercialTerms,
  decideSandboxCheckout,
  evaluateSandboxReleaseLimits,
  isApprovedSandboxSourcer,
  readGpSandboxPair,
  sandboxStripeModeForUser,
} from "../src/lib/payments/payout-rail/sandbox-pair.ts";

const BUYER = `c${"a".repeat(24)}`;
const SOURCER = `c${"b".repeat(24)}`;
const OTHER = `c${"d".repeat(24)}`;

const saved = {
  GLOBAL_PAYOUTS_ENABLED: process.env.GLOBAL_PAYOUTS_ENABLED,
  GLOBAL_PAYOUTS_SANDBOX_ENABLED: process.env.GLOBAL_PAYOUTS_SANDBOX_ENABLED,
  GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED: process.env.GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED,
  GLOBAL_PAYOUTS_COUNTRY_ALLOWLIST: process.env.GLOBAL_PAYOUTS_COUNTRY_ALLOWLIST,
  GP_SANDBOX_APPROVED_BUYER_ID: process.env.GP_SANDBOX_APPROVED_BUYER_ID,
  GP_SANDBOX_APPROVED_SOURCER_ID: process.env.GP_SANDBOX_APPROVED_SOURCER_ID,
  GP_SANDBOX_CURRENCY: process.env.GP_SANDBOX_CURRENCY,
  GP_SANDBOX_MAX_AMOUNT_MINOR: process.env.GP_SANDBOX_MAX_AMOUNT_MINOR,
  LIVE_PAYMENTS_ENABLED: process.env.LIVE_PAYMENTS_ENABLED,
};

let passed = 0;
function ok(name: string, cond: unknown) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`PASS ${name}`);
}

function clearPair() {
  delete process.env.GP_SANDBOX_APPROVED_BUYER_ID;
  delete process.env.GP_SANDBOX_APPROVED_SOURCER_ID;
  delete process.env.GP_SANDBOX_CURRENCY;
  delete process.env.GP_SANDBOX_MAX_AMOUNT_MINOR;
  delete process.env.GLOBAL_PAYOUTS_COUNTRY_ALLOWLIST;
  delete process.env.GLOBAL_PAYOUTS_ENABLED;
  delete process.env.GLOBAL_PAYOUTS_SANDBOX_ENABLED;
  delete process.env.GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED;
}

function enablePair() {
  process.env.GLOBAL_PAYOUTS_ENABLED = "true";
  process.env.GLOBAL_PAYOUTS_SANDBOX_ENABLED = "true";
  process.env.GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED = "false";
  process.env.GLOBAL_PAYOUTS_COUNTRY_ALLOWLIST = "TH";
  process.env.GP_SANDBOX_APPROVED_BUYER_ID = BUYER;
  process.env.GP_SANDBOX_APPROVED_SOURCER_ID = SOURCER;
  process.env.GP_SANDBOX_CURRENCY = "gbp";
  process.env.GP_SANDBOX_MAX_AMOUNT_MINOR = "5000";
}

try {
  clearPair();
  ok("missing configuration stays off", readGpSandboxPair() == null);
  ok("missing configuration does not select the sourcer", isApprovedSandboxSourcer(SOURCER) === false);
  ok(
    "missing configuration leaves checkout inactive",
    decideSandboxCheckout({ buyerId: BUYER, sellerId: SOURCER, ordinaryMode: "LIVE" }).state === "inactive",
  );

  process.env.GLOBAL_PAYOUTS_ENABLED = "true";
  process.env.GP_SANDBOX_APPROVED_BUYER_ID = BUYER;
  ok("partial ids stay off", readGpSandboxPair() == null);
  process.env.GP_SANDBOX_APPROVED_SOURCER_ID = BUYER;
  process.env.GP_SANDBOX_CURRENCY = "GBP";
  process.env.GP_SANDBOX_MAX_AMOUNT_MINOR = "5000";
  process.env.GLOBAL_PAYOUTS_COUNTRY_ALLOWLIST = "TH";
  ok("identical buyer and sourcer stay off", readGpSandboxPair() == null);

  process.env.GP_SANDBOX_APPROVED_SOURCER_ID = `${SOURCER},${OTHER}`;
  ok("id list is ambiguous", readGpSandboxPair() == null);
  process.env.GP_SANDBOX_APPROVED_SOURCER_ID = "testingtesting";
  ok("username is not an id", readGpSandboxPair() == null);
  process.env.GP_SANDBOX_APPROVED_SOURCER_ID = "person@example.com";
  ok("email is not an id", readGpSandboxPair() == null);
  process.env.GP_SANDBOX_APPROVED_SOURCER_ID = "*";
  ok("wildcard is not an id", readGpSandboxPair() == null);

  enablePair();
  process.env.GP_SANDBOX_CURRENCY = "GB";
  ok("short currency stays off", readGpSandboxPair() == null);
  process.env.GP_SANDBOX_CURRENCY = "GBP";
  process.env.GP_SANDBOX_MAX_AMOUNT_MINOR = "50.5";
  ok("fractional amount stays off", readGpSandboxPair() == null);
  process.env.GP_SANDBOX_MAX_AMOUNT_MINOR = "0";
  ok("zero amount stays off", readGpSandboxPair() == null);
  process.env.GP_SANDBOX_MAX_AMOUNT_MINOR = "5000";
  process.env.GLOBAL_PAYOUTS_COUNTRY_ALLOWLIST = "";
  ok("empty country allowlist stays off", readGpSandboxPair() == null);
  process.env.GLOBAL_PAYOUTS_COUNTRY_ALLOWLIST = "*";
  ok("wildcard country stays off", readGpSandboxPair() == null);
  process.env.GLOBAL_PAYOUTS_COUNTRY_ALLOWLIST = "TH";
  process.env.GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED = "true";
  ok("live initiation keeps the sandbox off", readGpSandboxPair() == null);
  process.env.GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED = "false";
  process.env.GLOBAL_PAYOUTS_SANDBOX_ENABLED = "false";
  ok("sandbox flag off stays off", readGpSandboxPair() == null);
  process.env.GLOBAL_PAYOUTS_ENABLED = "false";
  process.env.GLOBAL_PAYOUTS_SANDBOX_ENABLED = "true";
  ok("master flag off stays off", readGpSandboxPair() == null);

  enablePair();
  const pair = readGpSandboxPair();
  ok("valid pair enables TEST", pair?.enabled === true && pair.currency === "GBP" && pair.maxAmountMinor === 5000);
  const selected = decideSandboxCheckout({ buyerId: BUYER, sellerId: SOURCER, ordinaryMode: "LIVE" });
  ok(
    "approved pair selects TEST Global Payouts",
    selected.state === "pair" && selected.stripeMode === "TEST" && selected.payoutRail === "STRIPE_GLOBAL_PAYOUTS",
  );
  ok("approved sourcer onboarding uses TEST", sandboxStripeModeForUser(SOURCER) === "TEST");
  ok("ordinary user onboarding is not forced", sandboxStripeModeForUser(OTHER) == null);
  ok(
    "buyer with another sourcer is refused",
    decideSandboxCheckout({ buyerId: BUYER, sellerId: OTHER }).state === "refused",
  );
  ok("cross-pair ticket creation throws", (() => {
    try {
      assertSandboxCommercialTerms({
        buyerId: BUYER,
        sellerId: OTHER,
        currency: "GBP",
        principalMinor: 1000,
        paymentOption: "PROTECTED",
      });
      return false;
    } catch (err) {
      return (err as { code?: string }).code === "GP_SANDBOX_PAIR_REQUIRED";
    }
  })());
  ok(
    "sourcer with another buyer is refused",
    decideSandboxCheckout({ buyerId: OTHER, sellerId: SOURCER }).state === "refused",
  );
  ok(
    "reversed dedicated roles are refused",
    decideSandboxCheckout({ buyerId: SOURCER, sellerId: BUYER }).state === "refused",
  );
  const ordinary = decideSandboxCheckout({ buyerId: OTHER, sellerId: `c${"e".repeat(24)}`, ordinaryMode: "LIVE" });
  ok(
    "outside the pair keeps ordinary Connect",
    ordinary.state === "ordinary" && ordinary.stripeMode === "LIVE" && ordinary.payoutRail === "STRIPE_CONNECT",
  );

  const cover = evaluateSandboxReleaseLimits({
    buyerId: BUYER,
    sellerId: SOURCER,
    sourceCurrency: "gbp",
    principalMinor: 4000,
    providerFeeMinor: 100,
    crossBorderFeeMinor: 30,
    fxFeeMinor: 20,
    providerFeeCurrency: "gbp",
    crossBorderFeeCurrency: "gbp",
    fxFeeCurrency: "gbp",
    availableBalanceMinor: 4262,
    checkFunding: true,
  });
  ok(
    "reserve is principal plus separate fees",
    cover.ok && cover.separateFeeMinor === 150 && cover.requiredCoverMinor === 4150,
  );
  process.env.GP_SANDBOX_MAX_AMOUNT_MINOR = "4100";
  const over = evaluateSandboxReleaseLimits({
    buyerId: BUYER,
    sellerId: SOURCER,
    sourceCurrency: "GBP",
    principalMinor: 4000,
    providerFeeMinor: 150,
    crossBorderFeeMinor: 0,
    fxFeeMinor: 0,
    providerFeeCurrency: "GBP",
    crossBorderFeeCurrency: "GBP",
    fxFeeCurrency: "GBP",
    availableBalanceMinor: 5000,
    checkFunding: true,
  });
  ok("fee-inclusive cover above the cap is rejected", !over.ok && over.code === "GP_SANDBOX_AMOUNT_LIMIT");
  process.env.GP_SANDBOX_MAX_AMOUNT_MINOR = "5000";
  const short = evaluateSandboxReleaseLimits({
    buyerId: BUYER,
    sellerId: SOURCER,
    sourceCurrency: "GBP",
    principalMinor: 4000,
    providerFeeMinor: 150,
    crossBorderFeeMinor: 0,
    fxFeeMinor: 0,
    providerFeeCurrency: "GBP",
    crossBorderFeeCurrency: "GBP",
    fxFeeCurrency: "GBP",
    availableBalanceMinor: 4100,
    checkFunding: true,
  });
  ok("short funding is rejected", !short.ok && short.code === "GP_SANDBOX_FUNDING_SHORT");
  const unverified = evaluateSandboxReleaseLimits({
    buyerId: BUYER,
    sellerId: SOURCER,
    sourceCurrency: "GBP",
    principalMinor: 4000,
    providerFeeMinor: 0,
    crossBorderFeeMinor: 0,
    fxFeeMinor: 0,
    providerFeeCurrency: "",
    crossBorderFeeCurrency: "",
    fxFeeCurrency: "",
    availableBalanceMinor: null,
    checkFunding: true,
  });
  ok("unverified funding is rejected", !unverified.ok && unverified.code === "GP_SANDBOX_FUNDING_UNVERIFIED");
  const wrongCurrency = evaluateSandboxReleaseLimits({
    buyerId: BUYER,
    sellerId: SOURCER,
    sourceCurrency: "USD",
    principalMinor: 1000,
    providerFeeMinor: 0,
    crossBorderFeeMinor: 0,
    fxFeeMinor: 0,
    providerFeeCurrency: "",
    crossBorderFeeCurrency: "",
    fxFeeCurrency: "",
    availableBalanceMinor: 5000,
    checkFunding: true,
  });
  ok("wrong currency is rejected", !wrongCurrency.ok && wrongCurrency.code === "GP_SANDBOX_CURRENCY");
  const mismatch = evaluateSandboxReleaseLimits({
    buyerId: OTHER,
    sellerId: SOURCER,
    sourceCurrency: "GBP",
    principalMinor: 1000,
    providerFeeMinor: 0,
    crossBorderFeeMinor: 0,
    fxFeeMinor: 0,
    providerFeeCurrency: "",
    crossBorderFeeCurrency: "",
    fxFeeCurrency: "",
    availableBalanceMinor: 5000,
    checkFunding: true,
  });
  ok("release outside the pair is rejected", !mismatch.ok && mismatch.code === "GP_SANDBOX_PAIR_REQUIRED");
  const fx = evaluateSandboxReleaseLimits({
    buyerId: BUYER,
    sellerId: SOURCER,
    sourceCurrency: "GBP",
    principalMinor: 1000,
    providerFeeMinor: 10,
    crossBorderFeeMinor: 0,
    fxFeeMinor: 0,
    providerFeeCurrency: "USD",
    crossBorderFeeCurrency: "",
    fxFeeCurrency: "",
    availableBalanceMinor: 5000,
    checkFunding: true,
  });
  ok("foreign fee currency is rejected", !fx.ok && fx.code === "GP_PILOT_FEE_CURRENCY_UNRESOLVED");

  const tickets = readFileSync(new URL("../src/app/api/payments/tickets/route.ts", import.meta.url), "utf8");
  ok("ticket request schema has no stripe mode field", !tickets.includes("stripeMode"));
  const checkout = readFileSync(new URL("../src/lib/payments/checkout.ts", import.meta.url), "utf8");
  ok("checkout rejects a stored mode that is not the approved pair", checkout.includes("GP_SANDBOX_MODE_MISMATCH"));
  const webhook = readFileSync(
    new URL("../src/app/api/webhooks/stripe/global-payouts/route.ts", import.meta.url),
    "utf8",
  );
  ok("webhook rejects TEST and LIVE mismatches", webhook.includes("GP_WEBHOOK_MODE_MISMATCH"));
  const flags = readFileSync(new URL("../src/lib/payments/flags.ts", import.meta.url), "utf8");
  ok(
    "live payments default is unchanged",
    flags.includes('envBool("LIVE_PAYMENTS_ENABLED", false)') &&
      flags.includes('envBool("GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED", false)'),
  );

  console.log(`\n${passed} passed`);
} finally {
  for (const [key, value] of Object.entries(saved)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
}
