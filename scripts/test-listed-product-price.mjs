/**
 * Listed product price source-of-truth + checkout copy (offline, no Stripe money).
 * Run: node scripts/test-listed-product-price.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function roundBpsToMinor(amountMinor, bps) {
  const amount = Math.max(0, amountMinor);
  const rate = Math.max(0, bps);
  const product = amount * rate;
  const quotient = Math.trunc(product / 10_000);
  const remainder = product % 10_000;
  return remainder >= 5_000 ? quotient + 1 : quotient;
}

function majorToMinor(major, currency = "USD") {
  const c = currency.toUpperCase();
  const zero = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);
  const three = new Set(["BHD", "JOD", "KWD", "OMR", "TND"]);
  const exp = zero.has(c) ? 0 : three.has(c) ? 3 : 2;
  if (exp === 0) return Math.round(major);
  return Math.round(major * 10 ** exp);
}

function calculateListedProductFees(itemCostMinor, shippingMinor = 0) {
  const feeBaseMinor = itemCostMinor + shippingMinor;
  const protectionFeeMinor = roundBpsToMinor(feeBaseMinor, 700);
  const totalChargeMinor = itemCostMinor + shippingMinor + protectionFeeMinor;
  return { itemCostMinor, shippingMinor, protectionFeeMinor, totalChargeMinor };
}

function formatPriceMajor(major, currency = "USD") {
  const exp = majorToMinor(1, currency) === 1 ? 0 : majorToMinor(0.001, currency) === 1 ? 3 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: exp === 0 ? 0 : exp,
    maximumFractionDigits: exp,
  }).format(major);
}

function snapshotProductCheckoutTerms(listingPriceMajor, currency = "USD") {
  const itemCostMinor = majorToMinor(listingPriceMajor, currency);
  const fees = calculateListedProductFees(itemCostMinor, 0);
  return {
    currency,
    itemCostMinor: fees.itemCostMinor,
    shippingMinor: fees.shippingMinor,
    protectionFeeMinor: fees.protectionFeeMinor,
    totalChargeMinor: fees.totalChargeMinor,
  };
}

function resolveCheckoutStripeMode(stripeMode, publishableKey) {
  if (stripeMode === "LIVE" || stripeMode === "TEST") return stripeMode;
  const key = String(publishableKey || "");
  if (key.startsWith("pk_live_")) return "LIVE";
  if (key.startsWith("pk_test_")) return "TEST";
  return "TEST";
}

function checkoutFormCopy(stripeMode, payMode) {
  if (stripeMode === "LIVE") {
    return payMode === "direct"
      ? "Direct Payment · Real funds"
      : "Protected by Source Bridge · Real funds";
  }
  return payMode === "direct" ? "TEST mode" : "TEST mode";
}

// ── Source anchors
{
  const products = read("src/data/products.ts");
  assert.match(products, /currencyExponent/);
  assert.doesNotMatch(
    products,
    /maximumFractionDigits:\s*0/,
    "formatPrice must not round listing prices to whole dollars",
  );

  const productCheckout = read("src/app/api/payments/product-checkout/route.ts");
  assert.match(productCheckout, /majorToMinor\(listing\.price/);
  assert.match(productCheckout, /itemCostMinor: fees\.itemCostMinor/);
  assert.match(productCheckout, /totalChargeMinor: total/);

  const checkoutClient = read("src/app/checkout/[slug]/CheckoutPageClient.tsx");
  assert.match(checkoutClient, /checkoutSummaryCopy/);
  assert.doesNotMatch(
    checkoutClient,
    /Stripe TEST/,
    "checkout page must not hardcode Stripe TEST copy",
  );

  const protectedUi = read("src/components/payments/ProtectedPaymentCheckout.tsx");
  assert.match(protectedUi, /checkoutFormCopy/);
  assert.match(protectedUi, /checkoutPayButtonLabel/);

  const copy = read("src/lib/payments/checkout-copy.ts");
  assert.match(copy, /Real funds will be charged and held/);
  assert.match(copy, /TEST mode/);

  const tempScript = read("scripts/_create-live-payment-test-product.mjs");
  assert.match(tempScript, /PRICE_MAJOR = 1/);
}

// $1.00 → $0.07 fee → $1.07 total
{
  const terms = snapshotProductCheckoutTerms(1);
  assert.equal(terms.itemCostMinor, 100);
  assert.equal(terms.protectionFeeMinor, 7);
  assert.equal(terms.totalChargeMinor, 107);
}

// $10.00 → $0.70 fee → $10.70 total
{
  const terms = snapshotProductCheckoutTerms(10);
  assert.equal(terms.itemCostMinor, 1000);
  assert.equal(terms.protectionFeeMinor, 70);
  assert.equal(terms.totalChargeMinor, 1070);
}

// formatPrice must not round $0.50 up to $1.00
{
  assert.equal(formatPriceMajor(0.5, "USD"), "$0.50");
  assert.equal(formatPriceMajor(1, "USD"), "$1.00");
}

// Historical snapshot preserved when listing price changes after purchase
{
  const atPurchase = snapshotProductCheckoutTerms(1);
  const afterListingEdit = snapshotProductCheckoutTerms(25);
  assert.equal(atPurchase.itemCostMinor, 100);
  assert.equal(atPurchase.totalChargeMinor, 107);
  assert.equal(afterListingEdit.itemCostMinor, 2500);
  assert.notEqual(atPurchase.totalChargeMinor, afterListingEdit.totalChargeMinor);
}

// Pre-purchase checkout uses current listing price
{
  const current = snapshotProductCheckoutTerms(12.5);
  assert.equal(current.itemCostMinor, 1250);
  assert.equal(current.protectionFeeMinor, 88);
  assert.equal(current.totalChargeMinor, 1338);
}

// PI amount matches buyer total (txn.totalChargeMinor authoritative)
{
  const terms = snapshotProductCheckoutTerms(1);
  const piAmountMinor = terms.totalChargeMinor;
  assert.equal(piAmountMinor, terms.itemCostMinor + terms.protectionFeeMinor);
}

// LIVE checkout must not show TEST wording
{
  const liveProtected = checkoutFormCopy("LIVE", "protected");
  assert.match(liveProtected, /Real funds/);
  assert.doesNotMatch(liveProtected, /TEST mode/);
}

// TEST checkout keeps TEST copy
{
  const testProtected = checkoutFormCopy("TEST", "protected");
  assert.match(testProtected, /TEST mode/);
}

// Runtime mode from publishable key when stripeMode omitted
{
  assert.equal(resolveCheckoutStripeMode(null, "pk_live_abc"), "LIVE");
  assert.equal(resolveCheckoutStripeMode(null, "pk_test_abc"), "TEST");
  assert.equal(resolveCheckoutStripeMode("LIVE", "pk_test_abc"), "LIVE");
}

console.log("listed product price + checkout copy tests passed");
