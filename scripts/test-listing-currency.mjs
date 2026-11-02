/**
 * Listing currency policy for Connect vs Global Payouts.
 * Run: node scripts/test-listing-currency.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function defaultListingCurrency(gpProtected) {
  return gpProtected ? "GBP" : "USD";
}
function listingGpCurrencyOk(currency) {
  return String(currency || "USD").trim().toUpperCase() === "GBP";
}
function listingGpPriceMeetsMinimum(opts) {
  if (!listingGpCurrencyOk(opts.currency)) return false;
  return Math.round(opts.priceMajor * 100) >= 2500;
}

assert.equal(defaultListingCurrency(false), "USD");
assert.equal(defaultListingCurrency(true), "GBP");
assert.equal(listingGpCurrencyOk("GBP"), true);
assert.equal(listingGpCurrencyOk("USD"), false);
assert.equal(listingGpPriceMeetsMinimum({ priceMajor: 25, currency: "GBP" }), true);
assert.equal(listingGpPriceMeetsMinimum({ priceMajor: 24.99, currency: "GBP" }), false);

const helper = read("src/lib/payments/listing-currency.ts");
assert.match(helper, /gpProtected \? "GBP" : "USD"/);
assert.match(helper, /Global Payouts listings must be priced in GBP/);
assert.match(helper, /GP_GBP_MINIMUM_ENTITLEMENT_MINOR/);
assert.match(helper, /GP_GBP_FLAT_FEE_EXPLANATION/);
assert.doesNotMatch(helper, /SOURCE_BRIDGE_FEE_BPS/);

const editor = read("src/components/profile/editors/ListingEditor.tsx");
assert.match(editor, /Currency/);
assert.match(editor, /currencyPolicy/);
assert.match(editor, /currency: form\.currency/);
assert.doesNotMatch(editor, /inspection rules are met/);

const stock = read("src/app/api/stock/route.ts");
assert.match(stock, /assertListingCurrencyForPublish/);
assert.match(stock, /currencyPolicy/);
assert.match(stock, /defaultListingCurrency/);

const stockPatch = read("src/app/api/stock/[id]/route.ts");
assert.match(stockPatch, /assertListingCurrencyForPublish/);
assert.match(stockPatch, /currencyFromBody/);

const listingRoute = read("src/app/api/checkout/listing/[slug]/route.ts");
assert.match(listingRoute, /listingGpCurrencyOk/);
assert.match(listingRoute, /must be priced in GBP/);
assert.match(listingRoute, /gpListingMinimumCopy/);

console.log("[test-listing-currency] passed");
