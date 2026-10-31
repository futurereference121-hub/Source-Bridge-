/**
 * Separate GP onboarding from LIVE payment activation.
 * Offline — no Stripe, no database, no money objects.
 * Run: node --experimental-strip-types scripts/test-gp-onboarding-execution-split.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decideLiveGpRoute,
  evaluateLivePilotInitiation,
  globalPayoutsReconciliationAllowed,
  liveUserAllowed,
} from "../src/lib/payments/payout-rail/live-pilot.ts";

let passed = 0;
function ok(name: string, cond: unknown) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`PASS ${name}`);
}

function read(rel: string) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

ok(
  "onboarding TH without user allowlist takes GP",
  decideLiveGpRoute({
    purpose: "onboarding",
    gpEligibleCountry: true,
    userAllowed: false,
    connectUnsupported: true,
  }).takeGp === true,
);
ok(
  "execution TH without user allowlist does not take GP",
  decideLiveGpRoute({
    purpose: "execution",
    gpEligibleCountry: true,
    userAllowed: false,
    connectUnsupported: true,
  }).takeGp === false &&
    decideLiveGpRoute({
      purpose: "execution",
      gpEligibleCountry: true,
      userAllowed: false,
      connectUnsupported: true,
    }).unsupported === true &&
    decideLiveGpRoute({
      purpose: "execution",
      gpEligibleCountry: true,
      userAllowed: false,
      connectUnsupported: true,
    }).reason === "user_not_allowlisted",
);
ok(
  "execution TH with user allowlist takes GP",
  decideLiveGpRoute({
    purpose: "execution",
    gpEligibleCountry: true,
    userAllowed: true,
    connectUnsupported: true,
  }).takeGp === true,
);
ok(
  "unsupported country stays blocked for onboarding",
  decideLiveGpRoute({
    purpose: "onboarding",
    gpEligibleCountry: false,
    userAllowed: false,
    connectUnsupported: true,
  }).unsupported === true &&
    decideLiveGpRoute({
      purpose: "onboarding",
      gpEligibleCountry: false,
      userAllowed: false,
      connectUnsupported: true,
    }).reason === "connect_unsupported_country_not_allowlisted",
);
ok(
  "Connect-supported country stays on Connect for onboarding",
  decideLiveGpRoute({
    purpose: "onboarding",
    gpEligibleCountry: false,
    userAllowed: false,
    connectUnsupported: false,
  }).reason === "connect_default",
);

const eligibility = read("src/lib/payments/payout-rail/eligibility.ts");
ok(
  "onboarding write gate no longer mentions the user allowlist",
  !/assertLiveOnboardingWrite[\s\S]*isGlobalPayoutsUserAllowed/.test(eligibility),
);
ok(
  "onboarding write still requires a supported payout country",
  /assertLiveOnboardingWrite[\s\S]*isGlobalPayoutsCountryAllowed/.test(eligibility),
);
ok(
  "LIVE money helper still requires the initiation flag",
  eligibility.includes("isGlobalPayoutsLiveInitiationEnabled") &&
    eligibility.includes("GLOBAL_PAYOUTS_LIVE_INITIATION_DISABLED"),
);
ok(
  "empty LIVE user allowlist still denies execution identity",
  liveUserAllowed({
    enabled: true,
    mode: "LIVE",
    allowlistRaw: "",
    userId: "ordinary_user_1",
    email: "ordinary@example.com",
  }) === false,
);

ok(
  "reconciliation still works with initiation off",
  globalPayoutsReconciliationAllowed({
    masterEnabled: true,
    liveInitiationEnabled: false,
  }) === true,
);

const pilot = evaluateLivePilotInitiation({
  mode: "LIVE",
  gpEnabled: true,
  userAllowlistRaw: "",
  userId: "ordinary_user_1",
  email: "ordinary@example.com",
  countryAllowed: true,
  actorUserId: "buyer_user_1",
  buyerId: "buyer_user_1",
  sourceCurrency: "GBP",
  configuredSourceCurrencyRaw: "GBP",
  amountCapRaw: "2500",
  principalMinor: 2000,
  providerFeeMinor: 0,
  crossBorderFeeMinor: 0,
  fxFeeMinor: 0,
  providerFeeCurrency: "gbp",
  crossBorderFeeCurrency: "gbp",
  fxFeeCurrency: "gbp",
  availableBalanceMinor: 4000,
  destinationAmountMinor: 90000,
  destinationCurrency: "THB",
  destinationQuoted: true,
  destinationMinimumsRaw: "THB:60000",
  authorizedTransactionIdRaw: "txn_pilot_1",
  transactionId: "txn_pilot_1",
});
ok(
  "onboarding access does not authorize a LIVE payout",
  !pilot.ok && pilot.code === "GP_PILOT_USER_NOT_ALLOWLISTED",
);
ok(
  "LIVE empty allowlist still denies money identity",
  liveUserAllowed({
    enabled: true,
    mode: "LIVE",
    allowlistRaw: "",
    userId: "ordinary_user_1",
    email: "ordinary@example.com",
  }) === false,
);

const recipient = read("src/lib/payments/payout-rail/recipient.ts");
ok(
  "hosted onboarding no longer checks the user allowlist",
  !recipient.includes("isGlobalPayoutsUserAllowed"),
);
ok(
  "hosted onboarding still rechecks country before Stripe writes",
  recipient.includes("assertLiveOnboardingWrite") &&
    recipient.includes("isGlobalPayoutsCountryAllowed"),
);

const checkout = read("src/lib/payments/checkout.ts");
const quote = read("src/lib/payments/commercial-quote.ts");
const product = read("src/app/api/payments/product-checkout/route.ts");
const lock = read("src/lib/payments/payout-rail/rail-resolver.ts");
ok(
  "checkout does not use onboarding rail purpose",
  !checkout.includes('purpose: "onboarding"'),
);
ok(
  "commercial quote does not use onboarding rail purpose",
  !quote.includes('purpose: "onboarding"'),
);
ok(
  "product checkout does not use onboarding rail purpose",
  !product.includes('purpose: "onboarding"'),
);
ok(
  "fund lock snapshot stays on default execution purpose",
  lock.includes("buildPayoutRailLockSnapshot") &&
    !/buildPayoutRailLockSnapshot[\s\S]*purpose:\s*"onboarding"/.test(lock),
);

const outbound = read("src/lib/payments/payout-rail/outbound-payment.ts");
ok(
  "outbound payment still uses the LIVE user allowlist",
  outbound.includes("userAllowlistRaw: process.env.GLOBAL_PAYOUTS_USER_ALLOWLIST"),
);

console.log(`\n${passed} gp-onboarding-execution-split checks passed`);
