/**
 * Listed-product Global Payouts path — source/domain assertions.
 * No Stripe network, no charges, no payouts.
 *
 * Run: node scripts/test-gp-product-purchase.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

if (process.env.SB_GP_PRODUCT_TEST !== "1") {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/SECRET|TOKEN|KEY|DATABASE|POSTGRES|NEON|STRIPE|PASSWORD|COOKIE|AUTH/i.test(key)) {
      delete env[key];
    }
  }
  env.SB_GP_PRODUCT_TEST = "1";
  env.NODE_ENV = "test";
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", fileURLToPath(import.meta.url)],
    { cwd: root, env, stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const listingOptions = await import(
  pathToFileURL(path.join(root, "src/lib/payments/listing-options.ts")).href
);
const proceeds = await import(
  pathToFileURL(path.join(root, "src/lib/payments/payout-rail/proceeds-funding.ts")).href
);

assert.equal(
  listingOptions.listingProtectedSellerReady({
    connectReady: true,
    gpRail: false,
    gpReady: false,
    stripeMode: "LIVE",
  }),
  true,
);
assert.equal(
  listingOptions.listingProtectedSellerReady({
    connectReady: false,
    gpRail: true,
    gpReady: true,
    stripeMode: "TEST",
  }),
  true,
);
assert.equal(
  listingOptions.listingProtectedSellerReady({
    connectReady: false,
    gpRail: true,
    gpReady: true,
    stripeMode: "LIVE",
  }),
  false,
  "LIVE GP listed-product checkout stays closed while initiation is off",
);

assert.equal(
  proceeds.listedProductReleaseMayFund({
    origin: "PRODUCT_CHECKOUT",
    hasFinalOutboundAttempt: true,
  }),
  true,
);
assert.equal(
  proceeds.listedProductReleaseMayFund({
    origin: "CHAT_TICKET",
    hasFinalOutboundAttempt: true,
  }),
  false,
);

const listingRoute = read("src/app/api/checkout/listing/[slug]/route.ts");
assert.match(listingRoute, /listingProtectedSellerReady/);
assert.match(listingRoute, /isApprovedSandboxSourcer/);
assert.match(listingRoute, /baseProtectedGates/);
assert.match(listingRoute, /baseDirectGates/);
assert.match(listingRoute, /sellerConnectReady/);
assert.match(
  listingRoute,
  /baseDirectGates[\s\S]*sellerConnectReady/,
  "Direct listed-product checkout stays Connect-only",
);

const productCheckout = read("src/app/api/payments/product-checkout/route.ts");
assert.match(productCheckout, /origin: "PRODUCT_CHECKOUT"/);
assert.match(productCheckout, /snapshotStoredGlobalPayoutRail/);
assert.match(productCheckout, /sellerGpRecipientId/);
assert.match(productCheckout, /sellerGpPayoutMethodId/);
assert.doesNotMatch(
  productCheckout,
  /purpose: "onboarding"/,
  "product checkout must not use GP onboarding purpose",
);
assert.doesNotMatch(
  productCheckout,
  /bindLiveCollectionOnlyIfOpen/,
  "product checkout must not bind the named collection-only ticket",
);

const quote = read("src/lib/payments/commercial-quote.ts");
assert.match(quote, /opts\.origin === "PRODUCT_CHECKOUT"/);

const fulfilment = read("src/lib/payments/fulfilment.ts");
assert.match(
  fulfilment,
  /if \(opts\.origin === "PRODUCT_CHECKOUT"\) return false/,
);
assert.match(fulfilment, /PRODUCT_ADMIN_ONLY/);
assert.doesNotMatch(
  productCheckout,
  /procurementAdvanceAgreed: true/,
);

const runner = read("src/lib/payments/payout-rail/proceeds-funding-run.ts");
assert.match(runner, /listedProductReleaseMayFund/);
assert.match(runner, /buyerReleaseMayFund/);

const flags = read("src/lib/payments/flags.ts");
assert.match(
  flags,
  /envBool\("GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED", false\)/,
);

const claim = read("src/lib/payments/payout-rail/live-pilot-claim.ts");
assert.match(
  claim,
  /protectedTransaction: \{ origin: \{ not: "PRODUCT_CHECKOUT" \} \}/,
);

console.log("[test-gp-product-purchase] passed");
