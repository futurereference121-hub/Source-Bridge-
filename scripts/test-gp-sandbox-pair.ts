/**
 * Production Global Payouts Sandbox pair gate. No Stripe and no database.
 * Run: node --experimental-strip-types scripts/test-gp-sandbox-pair.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isGlobalPayoutsSandboxEnabled } from "../src/lib/payments/flags.ts";
import { globalPayoutsReconciliationAllowed } from "../src/lib/payments/payout-rail/live-pilot.ts";
import {
  assertSandboxCommercialTerms,
  decideSandboxCheckout,
  evaluateSandboxReleaseLimits,
  isApprovedSandboxParticipant,
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
  const partial = decideSandboxCheckout({ buyerId: BUYER, sellerId: SOURCER, ordinaryMode: "LIVE" });
  ok(
    "one valid id refuses that participant",
    partial.state === "refused" && partial.code === "GP_SANDBOX_CONFIG_INVALID",
  );
  ok(
    "one valid id leaves other customers ordinary",
    decideSandboxCheckout({
      buyerId: OTHER,
      sellerId: `c${"e".repeat(24)}`,
      ordinaryMode: "LIVE",
    }).state === "ordinary",
  );
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
  const badCurrency = decideSandboxCheckout({ buyerId: BUYER, sellerId: SOURCER, ordinaryMode: "LIVE" });
  ok(
    "partial currency refuses the pair",
    badCurrency.state === "refused" && badCurrency.code === "GP_SANDBOX_CONFIG_INVALID",
  );
  process.env.GP_SANDBOX_CURRENCY = "GBP";
  process.env.GP_SANDBOX_MAX_AMOUNT_MINOR = "50.5";
  ok("fractional amount stays off", readGpSandboxPair() == null);
  process.env.GP_SANDBOX_MAX_AMOUNT_MINOR = "0";
  ok("zero amount stays off", readGpSandboxPair() == null);
  process.env.GP_SANDBOX_MAX_AMOUNT_MINOR = "5000";
  process.env.GLOBAL_PAYOUTS_COUNTRY_ALLOWLIST = "";
  ok("empty country allowlist stays off", readGpSandboxPair() == null);
  const emptyCountry = decideSandboxCheckout({ buyerId: BUYER, sellerId: SOURCER, ordinaryMode: "LIVE" });
  ok("empty country refuses the pair", emptyCountry.state === "refused" && emptyCountry.code === "GP_SANDBOX_CONFIG_INVALID");
  process.env.GLOBAL_PAYOUTS_COUNTRY_ALLOWLIST = "*";
  ok("wildcard country stays off", readGpSandboxPair() == null);
  process.env.GLOBAL_PAYOUTS_COUNTRY_ALLOWLIST = "TH";
  process.env.GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED = "true";
  ok("live initiation keeps the sandbox off", readGpSandboxPair() == null);
  const liveOn = decideSandboxCheckout({ buyerId: BUYER, sellerId: SOURCER, ordinaryMode: "LIVE" });
  ok("live initiation does not open live checkout", liveOn.state === "refused");
  process.env.GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED = "false";
  process.env.GLOBAL_PAYOUTS_SANDBOX_ENABLED = "false";
  ok("sandbox flag off stays off", readGpSandboxPair() == null);
  const stopped = decideSandboxCheckout({ buyerId: BUYER, sellerId: SOURCER, ordinaryMode: "LIVE" });
  ok(
    "sandbox flag off refuses the pair",
    stopped.state === "refused" && stopped.code === "GP_SANDBOX_INITIATION_DISABLED",
  );
  ok("sandbox flag off still identifies the sourcer", isApprovedSandboxSourcer(SOURCER) === true);
  ok("sandbox flag off still identifies the buyer", isApprovedSandboxParticipant(BUYER) === true);
  ok("sandbox flag off stops TEST initiation", isGlobalPayoutsSandboxEnabled() === false);
  ok(
    "reconciliation stays allowed while the master flag is on",
    globalPayoutsReconciliationAllowed({
      masterEnabled: true,
      liveInitiationEnabled: false,
    }) === true,
  );
  const stoppedCross = decideSandboxCheckout({ buyerId: BUYER, sellerId: OTHER, ordinaryMode: "LIVE" });
  ok(
    "sandbox flag off still refuses cross-pair",
    stoppedCross.state === "refused" && stoppedCross.code === "GP_SANDBOX_PAIR_REQUIRED",
  );
  const stoppedOther = decideSandboxCheckout({
    buyerId: OTHER,
    sellerId: `c${"e".repeat(24)}`,
    ordinaryMode: "LIVE",
  });
  ok(
    "sandbox flag off leaves other customers ordinary",
    stoppedOther.state === "ordinary" && stoppedOther.stripeMode === "LIVE" && stoppedOther.payoutRail === "STRIPE_CONNECT",
  );
  const stoppedRelease = evaluateSandboxReleaseLimits({
    buyerId: BUYER,
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
    checkFunding: false,
  });
  ok("sandbox flag off rejects a new payout", !stoppedRelease.ok && stoppedRelease.code === "GP_SANDBOX_DISABLED");
  process.env.GLOBAL_PAYOUTS_ENABLED = "false";
  process.env.GLOBAL_PAYOUTS_SANDBOX_ENABLED = "true";
  ok("master flag off stays off", readGpSandboxPair() == null);
  const masterOff = decideSandboxCheckout({ buyerId: BUYER, sellerId: SOURCER, ordinaryMode: "LIVE" });
  ok("master flag off does not fall through to live", masterOff.state === "refused");
  ok(
    "master flag off stops reconciliation",
    globalPayoutsReconciliationAllowed({
      masterEnabled: false,
      liveInitiationEnabled: false,
    }) === false,
  );

  enablePair();
  const pair = readGpSandboxPair();
  ok("valid pair enables TEST", pair?.enabled === true && pair.currency === "GBP" && pair.maxAmountMinor === 5000);
  const selected = decideSandboxCheckout({ buyerId: BUYER, sellerId: SOURCER, ordinaryMode: "LIVE" });
  ok(
    "approved pair selects TEST Global Payouts",
    selected.state === "pair" && selected.stripeMode === "TEST" && selected.payoutRail === "STRIPE_GLOBAL_PAYOUTS",
  );
  ok("approved sourcer onboarding uses TEST", sandboxStripeModeForUser(SOURCER) === "TEST");
  ok("pair direct payment is refused", (() => {
    try {
      assertSandboxCommercialTerms({
        buyerId: BUYER,
        sellerId: SOURCER,
        currency: "GBP",
        principalMinor: 1000,
        paymentOption: "INSTANT",
      });
      return false;
    } catch (err) {
      return (err as { code?: string }).code === "GP_SANDBOX_PROTECTED_ONLY";
    }
  })());
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
  ok(
    "checkout keeps a stored Global Payouts rail",
    checkout.includes("snapshotStoredGlobalPayoutRail") && checkout.includes("honorStoredGlobalPayouts"),
  );
  const connect = readFileSync(new URL("../src/app/api/payments/connect/route.ts", import.meta.url), "utf8");
  ok("Connect onboarding blocks both approved participants", connect.includes("isApprovedSandboxParticipant"));
  const recipient = readFileSync(new URL("../src/lib/payments/payout-rail/recipient.ts", import.meta.url), "utf8");
  ok(
    "approved sourcer payout setup prefers TEST over the platform mode",
    recipient.indexOf("const sandbox = sandboxStripeModeForUser(userId);") <
      recipient.indexOf("if (mode) return normalizeStripeMode(mode);"),
  );
  const events = readFileSync(new URL("../src/lib/payments/payout-rail/events.ts", import.meta.url), "utf8");
  ok("webhook reconciliation follows the master flag", events.includes("globalPayoutsReconciliationAllowed"));
  ok("webhook reconciliation does not consult the sandbox flag", !events.includes("isGlobalPayoutsSandboxEnabled"));
  const quote = readFileSync(new URL("../src/lib/payments/payout-rail/quote-review.ts", import.meta.url), "utf8");
  ok("quotes check initiation before provider preparation", quote.includes("initiationEnabled: canInitiateGlobalPayoutsMoney(txnMode)"));
  const product = readFileSync(new URL("../src/app/api/payments/product-checkout/route.ts", import.meta.url), "utf8");
  ok(
    "listed checkout gates the pair before Connect status",
    product.indexOf("const sandboxParticipants = decideSandboxCheckout") <
      product.indexOf("getConnectStatus(listing.userId)"),
  );
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
