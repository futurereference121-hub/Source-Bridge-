/**
 * Approved GBP Global Payouts price. No Stripe, no database, no purchases.
 * Run: node scripts/test-gp-gbp-pricing.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

if (process.env.SB_GP_GBP_PRICING_TEST !== "1") {
  const env = { ...process.env, SB_GP_GBP_PRICING_TEST: "1", NODE_ENV: "test" };
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

const { readFileSync } = fs;
const assert = (await import("node:assert/strict")).default;
const {
  GP_GBP_FEE_EXPLANATION,
  GP_GBP_PROGRESSIVE_V1,
  feeExplanationForPolicy,
  formatGbpMinor,
  globalPayoutsGbpFeeMinor,
  gpGbpEntitlementFloorMinor,
} = await import("../src/lib/payments/gp-pricing.ts");
const { priceAfterResolvedRail } = await import("../src/lib/payments/commercial-quote.ts");
const { roundBpsToMinor } = await import("../src/lib/payments/money.ts");
const { hashTerms } = await import("../src/lib/payments/terms.ts");
const {
  assertFinalReleaseInvariants,
  assertProcurementReleaseInvariants,
  computeProtectedFinancials,
} = await import("../src/lib/payments/breakdown.ts");

const connectConfig = {
  protectionFeeBps: 700,
  protectionFeeFloorMinor: 0,
  sellerServiceFeeBps: 0,
  directServiceFeeBps: 700,
  directServiceFeeFloorMinor: 0,
};

function gpQuote(entitlement, extra = {}) {
  return priceAfterResolvedRail({
    itemCostMinor: entitlement,
    shippingMinor: 0,
    sellerServiceFeeMinor: 0,
    currency: "GBP",
    paymentOption: "PROTECTED",
    payoutRail: "STRIPE_GLOBAL_PAYOUTS",
    existingPricingPolicy: null,
    config: connectConfig,
    destinationMinimumsRaw: "",
    ...extra,
  });
}

const approved = [
  [2500, 375, 2875],
  [3500, 525, 4025],
  [5000, 750, 5750],
  [10000, 1500, 11500],
  [20000, 2400, 22400],
  [50000, 5100, 55100],
];
for (const [entitlement, fee, total] of approved) {
  const quoted = gpQuote(entitlement);
  assert.equal(quoted.protectionFeeMinor, fee, `fee for ${entitlement}`);
  assert.equal(quoted.totalChargeMinor, total, `total for ${entitlement}`);
  assert.equal(quoted.pricingPolicy, GP_GBP_PROGRESSIVE_V1);
  assert.equal(quoted.feeExplanation, GP_GBP_FEE_EXPLANATION);
  assert.equal(globalPayoutsGbpFeeMinor(entitlement), fee);
}

assert.equal(globalPayoutsGbpFeeMinor(2501), 375);
assert.equal(globalPayoutsGbpFeeMinor(9999), 1500);
assert.equal(globalPayoutsGbpFeeMinor(10000), 1500);
assert.equal(globalPayoutsGbpFeeMinor(10001), 1500);
assert.equal(globalPayoutsGbpFeeMinor(10006), 1501);
assert.equal(gpQuote(2500).totalChargeMinor, 2875);
assert.equal(gpQuote(2501).totalChargeMinor, 2876);
assert.equal(gpQuote(9999).totalChargeMinor, 11499);
assert.equal(gpQuote(10000).totalChargeMinor, 11500);
assert.equal(gpQuote(10001).totalChargeMinor, 11501);
assert.equal(gpQuote(10006).totalChargeMinor, 11507);

for (let entitlement = 0; entitlement < 20000; entitlement += 1) {
  const next = entitlement + 1;
  const total = entitlement + globalPayoutsGbpFeeMinor(entitlement);
  const nextTotal = next + globalPayoutsGbpFeeMinor(next);
  assert.ok(nextTotal > total, `buyer total decreased at ${entitlement}`);
}

assert.throws(() => gpQuote(2499), (err) => err.code === "GP_MINIMUM_ENTITLEMENT");
assert.throws(() => gpQuote(3500, { currency: "EUR" }), (err) => err.code === "GP_PRICING_CURRENCY_UNSUPPORTED");
assert.throws(() => gpQuote(3500, { currency: "THB" }), (err) => err.code === "GP_PRICING_CURRENCY_UNSUPPORTED");
assert.throws(() => gpQuote(3500, { currency: "USD" }), (err) => err.code === "GP_PRICING_CURRENCY_UNSUPPORTED");
assert.throws(
  () => gpQuote(3500, { platformFeeIncludedInPrice: true }),
  (err) => err.code === "GP_FEE_ADDED_ON_TOP",
);

assert.equal(gpGbpEntitlementFloorMinor(""), 2500);
assert.equal(gpGbpEntitlementFloorMinor("THB:500000"), 2500);
assert.equal(gpGbpEntitlementFloorMinor("GBP:1000"), 2500);
assert.equal(gpGbpEntitlementFloorMinor("GBP:4000,THB:500000"), 4000);
assert.equal(gpQuote(2500, { destinationMinimumsRaw: "THB:999999" }).protectionFeeMinor, 375);
assert.throws(
  () => gpQuote(3500, { destinationMinimumsRaw: "GBP:4000" }),
  (err) => err.code === "GP_MINIMUM_ENTITLEMENT" && String(err.message).includes(formatGbpMinor(4000)),
);
assert.equal(gpQuote(4000, { destinationMinimumsRaw: "GBP:4000" }).protectionFeeMinor, 600);
assert.throws(() => gpGbpEntitlementFloorMinor("GBP:nope"), (err) => err.code === "GP_PILOT_DESTINATION_MINIMUMS_INVALID");

const connect = priceAfterResolvedRail({
  itemCostMinor: 1000,
  shippingMinor: 0,
  sellerServiceFeeMinor: 0,
  currency: "GBP",
  paymentOption: "PROTECTED",
  payoutRail: "STRIPE_CONNECT",
  existingPricingPolicy: null,
  config: connectConfig,
});
assert.equal(connect.protectionFeeMinor, roundBpsToMinor(1000, 700));
assert.equal(connect.pricingPolicy, "");
assert.equal(connect.feeExplanation, "");
const connectLarge = priceAfterResolvedRail({
  itemCostMinor: 20000,
  shippingMinor: 0,
  sellerServiceFeeMinor: 0,
  currency: "EUR",
  paymentOption: "PROTECTED",
  payoutRail: "STRIPE_CONNECT",
  existingPricingPolicy: null,
  config: connectConfig,
});
assert.equal(connectLarge.protectionFeeMinor, 1400);
assert.notEqual(connectLarge.protectionFeeMinor, globalPayoutsGbpFeeMinor(20000));

const legacy = priceAfterResolvedRail({
  itemCostMinor: 2000,
  shippingMinor: 500,
  sellerServiceFeeMinor: 1000,
  currency: "GBP",
  paymentOption: "PROTECTED",
  payoutRail: "STRIPE_GLOBAL_PAYOUTS",
  existingPricingPolicy: "",
  config: connectConfig,
});
assert.equal(legacy.protectionFeeMinor, 245);
assert.equal(legacy.totalChargeMinor, 3745);
assert.equal(legacy.pricingPolicy, "");
assert.notEqual(legacy.protectionFeeMinor, globalPayoutsGbpFeeMinor(3500));

const legacyBooks = computeProtectedFinancials({
  itemCostMinor: 2000,
  shippingMinor: 500,
  sellerServiceFeeMinor: 1000,
  protectionFeeMinor: legacy.protectionFeeMinor,
  totalChargeMinor: legacy.totalChargeMinor,
  procurementAdvanceAgreed: true,
  procurementAdvanceMinor: 2000,
});
assert.equal(legacyBooks.platformFeeMinor, 245);
assert.equal(legacyBooks.sellerEntitledMinor, 3500);

const fresh = gpQuote(3500);
const freshBooks = computeProtectedFinancials({
  itemCostMinor: 3500,
  shippingMinor: 0,
  sellerServiceFeeMinor: 0,
  protectionFeeMinor: fresh.protectionFeeMinor,
  totalChargeMinor: fresh.totalChargeMinor,
  procurementAdvanceAgreed: true,
  procurementAdvanceMinor: 2000,
});
assert.equal(freshBooks.sellerEntitledMinor, 3500);
assert.equal(freshBooks.platformFeeMinor, 525);
assertProcurementReleaseInvariants({
  sellerEntitledMinor: freshBooks.sellerEntitledMinor,
  procurementAdvanceMinor: 2000,
  procurementTransferredMinor: 0,
  finalTransferredMinor: 0,
  nextProcurementDelta: 2000,
});
assertFinalReleaseInvariants({
  sellerEntitledMinor: freshBooks.sellerEntitledMinor,
  procurementTransferredMinor: 2000,
  finalTransferredMinor: 0,
  nextFinalDelta: 1500,
});
assert.throws(() =>
  assertFinalReleaseInvariants({
    sellerEntitledMinor: freshBooks.sellerEntitledMinor,
    procurementTransferredMinor: 2000,
    finalTransferredMinor: 0,
    nextFinalDelta: 1501,
  }),
);

const terms = {
  currency: "GBP",
  itemCostMinor: 3500,
  shippingMinor: 0,
  sellerServiceFeeMinor: 0,
  protectionFeeMinor: 525,
  totalChargeMinor: 4025,
  paymentOption: "PROTECTED",
  procurementAdvanceAgreed: false,
  procurementAdvanceMinor: 0,
  title: "Protected Payment",
  listingId: null,
  buyerId: "buyer",
  sellerId: "sourcer",
  revision: 1,
};
assert.equal(hashTerms(terms), hashTerms({ ...terms, pricingPolicy: "" }));
assert.notEqual(hashTerms(terms), hashTerms({ ...terms, pricingPolicy: GP_GBP_PROGRESSIVE_V1 }));
assert.equal(feeExplanationForPolicy(""), "");
assert.equal(feeExplanationForPolicy(GP_GBP_PROGRESSIVE_V1), GP_GBP_FEE_EXPLANATION);

for (const rel of [
  "src/lib/payments/release.ts",
  "src/lib/payments/checkout.ts",
  "src/lib/payments/payout-rail/outbound-payment.ts",
  "src/lib/payments/payout-rail/outbound-quote.ts",
]) {
  const source = readFileSync(path.join(root, rel), "utf8");
  assert.doesNotMatch(source, /globalPayoutsGbpFeeMinor|quoteCommercialTerms|gp-pricing/);
}
const flags = readFileSync(path.join(root, "src/lib/payments/flags.ts"), "utf8");
assert.match(flags, /envBool\("GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED", false\)/);
const pricingSource = readFileSync(path.join(root, "src/lib/payments/gp-pricing.ts"), "utf8");
assert.doesNotMatch(pricingSource, /GLOBAL_PAYOUTS_SANDBOX_ENABLED\s*=/);
assert.doesNotMatch(pricingSource, /LIVE_PAYMENTS_ENABLED\s*=/);

console.log("gp-gbp-pricing: PASS");
