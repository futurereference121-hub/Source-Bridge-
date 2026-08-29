/**
 * Protected payment currency allowlist + minor-unit rules (offline).
 * Run: node scripts/test-payment-currencies.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const configSrc = read("src/lib/payments/config.ts");
const supportedSrc = read("src/lib/payments/supported-currencies.ts");
const moneySrc = read("src/lib/payments/money.ts");
const proposeSrc = read("src/components/messaging/ProposePaymentTicketButton.tsx");
const checkoutSrc = read("src/lib/payments/checkout.ts");
const productSrc = read("src/app/api/payments/product-checkout/route.ts");
const ticketsSrc = read("src/lib/payments/tickets.ts");

assert.match(supportedSrc, /EUR/);
assert.match(supportedSrc, /resolveAllowedPaymentCurrencies/);
assert.match(
  supportedSrc,
  /This currency isn't currently supported for protected payments/,
);
assert.doesNotMatch(configSrc, /Currency \$\{c\} is not enabled/);
assert.doesNotMatch(configSrc, /\["USD", "GBP"\]/);
assert.match(configSrc, /resolveAllowedPaymentCurrencies/);
assert.match(configSrc, /UNSUPPORTED_PROTECTED_CURRENCY_MESSAGE/);
assert.match(moneySrc, /STRIPE_ZERO_DECIMAL_CURRENCIES/);
assert.match(proposeSrc, /TICKET_CURRENCY_OPTIONS/);
assert.match(proposeSrc, /EUR/);
assert.doesNotMatch(proposeSrc, /return `£\$\{/);
assert.match(checkoutSrc, /currency: txn\.currency\.toLowerCase\(\)/);
assert.match(productSrc, /assertCurrencyAllowed/);
assert.match(ticketsSrc, /assertCurrencyAllowed/);

const runner = `
import assert from "node:assert/strict";
import {
  resolveAllowedPaymentCurrencies,
  isAllowedPaymentCurrency,
  UNSUPPORTED_PROTECTED_CURRENCY_MESSAGE,
  STRIPE_PRESENTMENT_CURRENCIES,
} from "../src/lib/payments/supported-currencies.ts";
import {
  majorToMinor,
  minorToMajor,
  formatMinor,
  normalizeCurrency,
} from "../src/lib/payments/money.ts";
import { calculateFees } from "../src/lib/payments/fees.ts";

const SOURCE_BRIDGE_FEE_BPS = 700;

const legacy = resolveAllowedPaymentCurrencies({ dbJson: '["USD"]', envRaw: null });
assert.ok(legacy.includes("EUR"), "legacy USD DB default must allow EUR");
assert.ok(legacy.includes("GBP"));
assert.ok(legacy.includes("USD"));
assert.ok(legacy.length > 10);

const full = resolveAllowedPaymentCurrencies({ dbJson: null, envRaw: null });
assert.ok(full.includes("EUR"));

const restricted = resolveAllowedPaymentCurrencies({
  dbJson: '["EUR","GBP"]',
  envRaw: null,
});
assert.deepEqual(restricted, ["EUR", "GBP"]);

const envOnly = resolveAllowedPaymentCurrencies({
  dbJson: '["EUR","GBP"]',
  envRaw: "USD,JPY",
});
assert.deepEqual(envOnly, ["JPY", "USD"]);

assert.equal(isAllowedPaymentCurrency("eur", legacy), true);
assert.equal(isAllowedPaymentCurrency("ZZZ", legacy), false);
assert.equal(UNSUPPORTED_PROTECTED_CURRENCY_MESSAGE.includes("isn't currently supported"), true);
assert.equal(UNSUPPORTED_PROTECTED_CURRENCY_MESSAGE.includes("is not enabled"), false);

assert.equal(normalizeCurrency("eur"), "EUR");
assert.equal(majorToMinor(50, "EUR"), 5000);
assert.equal(majorToMinor(50, "USD"), 5000);
assert.equal(majorToMinor(50, "GBP"), 5000);
assert.equal(majorToMinor(50, "JPY"), 50);
assert.equal(minorToMajor(5000, "EUR"), 50);
assert.equal(minorToMajor(50, "JPY"), 50);

const feeCfg = {
  protectionFeeBps: SOURCE_BRIDGE_FEE_BPS,
  protectionFeeFloorMinor: 0,
  sellerServiceFeeBps: 0,
  directServiceFeeBps: SOURCE_BRIDGE_FEE_BPS,
  directServiceFeeFloorMinor: 0,
};

const feeEur = calculateFees({
  itemCostMinor: 5000,
  shippingMinor: 0,
  config: feeCfg,
  paymentOption: "PROTECTED",
});
assert.equal(feeEur.protectionFeeMinor, 350);

const feeJpy = calculateFees({
  itemCostMinor: 5000,
  shippingMinor: 0,
  config: feeCfg,
  paymentOption: "PROTECTED",
});
assert.equal(feeJpy.protectionFeeMinor, 350);

const formatted = formatMinor(5000, "EUR");
assert.ok(/50/.test(formatted), "EUR format: " + formatted);

console.log("payment-currencies-runtime: ok", {
  stripeCount: STRIPE_PRESENTMENT_CURRENCIES.length,
  legacyCount: legacy.length,
});
`;

const runtimePath = path.join(root, ".cursor/_currency_runtime.mts");
fs.writeFileSync(runtimePath, runner);
const r = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["tsx", runtimePath],
  { cwd: root, encoding: "utf8", shell: true },
);
if (r.status !== 0) {
  console.error(r.stdout);
  console.error(r.stderr);
  process.exit(r.status || 1);
}
console.log(r.stdout.trim());
console.log("test-payment-currencies: PASS");
