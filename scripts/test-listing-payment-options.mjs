/**
 * Listing payment-option + checkout blocking unit tests (no DB).
 * Run: node scripts/test-listing-payment-options.mjs
 */
import assert from "node:assert/strict";
const LISTING_PAYMENT_OPTIONS = ["CONTACT_ONLY","PROTECTED_ONLY","INSTANT_ONLY","BOTH"];
function parseListingPaymentOptions(raw) {
  const v = (raw || "PROTECTED_ONLY").toUpperCase();
  if (LISTING_PAYMENT_OPTIONS.includes(v)) return v;
  return "PROTECTED_ONLY";
}
function listingPaymentFlags(raw) {
  const option = parseListingPaymentOptions(raw);
  switch (option) {
    case "BOTH": return { protectedPaymentEnabled: true, directPaymentEnabled: true };
    case "INSTANT_ONLY": return { protectedPaymentEnabled: false, directPaymentEnabled: true };
    case "PROTECTED_ONLY": return { protectedPaymentEnabled: true, directPaymentEnabled: false };
    case "CONTACT_ONLY": return { protectedPaymentEnabled: true, directPaymentEnabled: false };
    default: return { protectedPaymentEnabled: true, directPaymentEnabled: false };
  }
}
function encodeListingPaymentOptions(flags) {
  const p = Boolean(flags.protectedPaymentEnabled);
  const d = Boolean(flags.directPaymentEnabled);
  if (!p && !d) {
    const err = new Error("Choose at least one payment option.");
    err.status = 400; err.code = "PAYMENT_OPTIONS_REQUIRED"; throw err;
  }
  if (p && d) return "BOTH";
  if (d) return "INSTANT_ONLY";
  return "PROTECTED_ONLY";
}
function listingAllowsProtected(option) {
  return option === "PROTECTED_ONLY" || option === "BOTH" || option === "CONTACT_ONLY";
}
function listingAllowsDirect(option) {
  return option === "INSTANT_ONLY" || option === "BOTH";
}
function assertListingCheckoutOption(opts) {
  const option = parseListingPaymentOptions(opts.listingOption);
  if (opts.selected === "PROTECTED") {
    if (!listingAllowsProtected(option)) {
      const err = new Error("This item is available for Direct Payment only.");
      err.status = 400; throw err;
    }
    return;
  }
  if (opts.selected === "INSTANT" || opts.selected === "DIRECT") {
    if (!listingAllowsDirect(option)) {
      const err = new Error("This item is available for Protected Payment only.");
      err.status = 400; throw err;
    }
  }
}
assert.equal(encodeListingPaymentOptions({ protectedPaymentEnabled: true, directPaymentEnabled: false }), "PROTECTED_ONLY");
assert.equal(encodeListingPaymentOptions({ protectedPaymentEnabled: false, directPaymentEnabled: true }), "INSTANT_ONLY");
assert.equal(encodeListingPaymentOptions({ protectedPaymentEnabled: true, directPaymentEnabled: true }), "BOTH");
assert.throws(() => encodeListingPaymentOptions({ protectedPaymentEnabled: false, directPaymentEnabled: false }), /Choose at least one/);
assert.deepEqual(listingPaymentFlags("BOTH"), { protectedPaymentEnabled: true, directPaymentEnabled: true });
assert.deepEqual(listingPaymentFlags("CONTACT_ONLY"), { protectedPaymentEnabled: true, directPaymentEnabled: false });
assert.equal(parseListingPaymentOptions(""), "PROTECTED_ONLY");
assert.throws(() => assertListingCheckoutOption({ listingOption: "PROTECTED_ONLY", selected: "DIRECT" }), /Protected Payment only/);
assert.throws(() => assertListingCheckoutOption({ listingOption: "INSTANT_ONLY", selected: "PROTECTED" }), /Direct Payment only/);
assert.doesNotThrow(() => assertListingCheckoutOption({ listingOption: "BOTH", selected: "DIRECT" }));
assert.throws(() => assertListingCheckoutOption({ listingOption: "CONTACT_ONLY", selected: "DIRECT" }), /Protected Payment only/);
console.log("test-listing-payment-options: OK");