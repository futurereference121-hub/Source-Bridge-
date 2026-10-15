/**
 * Read-only USD Connect settlement diagnostic. No Stripe network and no database.
 * Run: node scripts/test-usd-connect-settlement.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

if (process.env.SB_USD_SETTLEMENT_TEST !== "1") {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/SECRET|TOKEN|KEY|DATABASE|POSTGRES|NEON|STRIPE|PASSWORD|COOKIE|AUTH/i.test(key)) {
      delete env[key];
    }
  }
  env.SB_USD_SETTLEMENT_TEST = "1";
  env.NODE_ENV = "test";
  const result = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(import.meta.url)], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

const settlement = await import(
  pathToFileURL(path.join(root, "src/lib/payments/payout-rail/usd-connect-settlement.ts")).href
);
const {
  isUsdConnectSettlementPurchase,
  shapeChargeSettlement,
  shapePlatformBalance,
} = settlement;

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

assert.equal(isUsdConnectSettlementPurchase({
  stripeMode: "TEST",
  currency: "usd",
  payoutRail: "STRIPE_CONNECT",
  fundedAt: "2026-01-01T00:00:00.000Z",
}), true);
assert.equal(isUsdConnectSettlementPurchase({
  stripeMode: "LIVE",
  currency: "USD",
  payoutRail: "STRIPE_CONNECT",
  fundedAt: "2026-01-01T00:00:00.000Z",
}), false);
assert.equal(isUsdConnectSettlementPurchase({
  stripeMode: "TEST",
  currency: "GBP",
  payoutRail: "STRIPE_CONNECT",
  fundedAt: "2026-01-01T00:00:00.000Z",
}), false);
assert.equal(isUsdConnectSettlementPurchase({
  stripeMode: "TEST",
  currency: "USD",
  payoutRail: "STRIPE_GLOBAL_PAYOUTS",
  fundedAt: "2026-01-01T00:00:00.000Z",
}), false);
assert.equal(isUsdConnectSettlementPurchase({
  stripeMode: "TEST",
  currency: "USD",
  payoutRail: "STRIPE_CONNECT",
  fundedAt: null,
}), false);

const settled = shapeChargeSettlement({
  purchaseHash: "aaaaaaaa",
  purchaseCurrency: "USD",
  chargeIdPresent: true,
  charge: {
    livemode: false,
    currency: "usd",
    balanceTransaction: {
      livemode: false,
      currency: "gbp",
      amount: 1800,
      fee: 80,
      net: 1720,
      exchange_rate: 0.78,
      status: "available",
      available_on: Date.parse("2026-10-17T00:00:00.000Z") / 1000,
    },
  },
});
assert.equal(settled.read.ok, true);
assert.equal(settled.purchaseCurrency, "USD");
assert.equal(settled.chargeCurrency, "USD");
assert.equal(settled.balanceTransactionCurrency, "GBP");
assert.equal(settled.grossMinor, 1800);
assert.equal(settled.feeMinor, 80);
assert.equal(settled.netMinor, 1720);
assert.equal(settled.exchangeRate, 0.78);
assert.equal(settled.availabilityStatus, "available");
assert.equal(settled.availableOn, "2026-10-17T00:00:00.000Z");

const noRate = shapeChargeSettlement({
  purchaseHash: "bbbbbbbb",
  purchaseCurrency: "USD",
  chargeIdPresent: true,
  charge: {
    livemode: false,
    currency: "usd",
    balanceTransaction: {
      livemode: false,
      currency: "usd",
      amount: 2550,
      fee: 100,
      net: 2450,
      exchange_rate: null,
      status: "pending",
      available_on: Date.parse("2026-10-20T00:00:00.000Z") / 1000,
    },
  },
});
assert.equal(noRate.exchangeRate, null);
assert.equal(noRate.balanceTransactionCurrency, "USD");
assert.equal(noRate.availabilityStatus, "pending");

const missingCharge = shapeChargeSettlement({
  purchaseHash: "cccccccc",
  purchaseCurrency: "USD",
  chargeIdPresent: false,
});
assert.equal(missingCharge.read.ok, false);
assert.equal(missingCharge.read.stripeCode, "charge_id_missing");
assert.equal(missingCharge.grossMinor, null);
assert.equal(missingCharge.feeMinor, null);
assert.equal(missingCharge.netMinor, null);
assert.equal(missingCharge.exchangeRate, null);

const providerFailure = shapeChargeSettlement({
  purchaseHash: "dddddddd",
  purchaseCurrency: "USD",
  chargeIdPresent: true,
  failure: { httpStatus: 404, stripeCode: "resource_missing" },
});
assert.equal(providerFailure.read.ok, false);
assert.equal(providerFailure.read.httpStatus, 404);
assert.equal(providerFailure.grossMinor, null);
assert.equal(providerFailure.netMinor, null);

const schemaWithoutLivemode = shapeChargeSettlement({
  purchaseHash: "12121212",
  purchaseCurrency: "USD",
  chargeIdPresent: true,
  charge: {
    livemode: false,
    currency: "usd",
    balanceTransaction: {
      currency: "gbp",
      amount: 2010,
      fee: 90,
      net: 1920,
      exchange_rate: 0.79,
      status: "pending",
      available_on: Date.parse("2026-10-17T00:00:00.000Z") / 1000,
    },
  },
});
assert.equal(schemaWithoutLivemode.read.ok, true);
assert.equal(schemaWithoutLivemode.chargeCurrency, "USD");
assert.equal(schemaWithoutLivemode.balanceTransactionCurrency, "GBP");
assert.equal(schemaWithoutLivemode.grossMinor, 2010);
assert.equal(schemaWithoutLivemode.feeMinor, 90);
assert.equal(schemaWithoutLivemode.netMinor, 1920);
assert.equal(schemaWithoutLivemode.exchangeRate, 0.79);
assert.equal(schemaWithoutLivemode.availabilityStatus, "pending");

const explicitLiveTransaction = shapeChargeSettlement({
  purchaseHash: "13131313",
  purchaseCurrency: "USD",
  chargeIdPresent: true,
  charge: {
    livemode: false,
    currency: "usd",
    balanceTransaction: {
      livemode: true,
      currency: "gbp",
      amount: 2010,
      fee: 90,
      net: 1920,
      status: "available",
      available_on: 1,
    },
  },
});
assert.equal(explicitLiveTransaction.read.stripeCode, "mode_mismatch");
assert.equal(explicitLiveTransaction.grossMinor, null);
assert.equal(explicitLiveTransaction.netMinor, null);
assert.equal(explicitLiveTransaction.chargeCurrency, null);

const liveCharge = shapeChargeSettlement({
  purchaseHash: "eeeeeeee",
  purchaseCurrency: "USD",
  chargeIdPresent: true,
  charge: { livemode: true, currency: "usd", balanceTransaction: { livemode: true, amount: 10, fee: 1, net: 9, currency: "usd", status: "available", available_on: 1 } },
});
assert.equal(liveCharge.read.stripeCode, "mode_mismatch");
assert.equal(liveCharge.grossMinor, null);
assert.equal(liveCharge.netMinor, null);

const missingTransaction = shapeChargeSettlement({
  purchaseHash: "ffffffff",
  purchaseCurrency: "USD",
  chargeIdPresent: true,
  charge: { livemode: false, currency: "usd", balanceTransaction: null },
});
assert.equal(missingTransaction.read.stripeCode, "balance_transaction_missing");
assert.equal(missingTransaction.chargeCurrency, "USD");
assert.equal(missingTransaction.grossMinor, null);
assert.equal(missingTransaction.feeMinor, null);
assert.equal(missingTransaction.netMinor, null);

const partial = [
  settled,
  providerFailure,
];
assert.equal(partial[0].netMinor, 1720);
assert.equal(partial[1].netMinor, null);
assert.notEqual(partial[1].netMinor, 0);

const missingFee = shapeChargeSettlement({
  purchaseHash: "11111111",
  purchaseCurrency: "USD",
  chargeIdPresent: true,
  charge: {
    livemode: false,
    currency: "usd",
    balanceTransaction: {
      livemode: false,
      currency: "gbp",
      amount: 1800,
      net: 1720,
      status: "available",
      available_on: 1,
    },
  },
});
assert.equal(missingFee.read.stripeCode, "balance_amounts_missing");
assert.equal(missingFee.grossMinor, null);
assert.equal(missingFee.feeMinor, null);
assert.equal(missingFee.netMinor, null);

const balance = shapePlatformBalance({
  livemode: false,
  available: [{ currency: "gbp", amount: 624 }, { currency: "usd" }],
  pending: [{ currency: "gbp", amount: 3878 }],
});
assert.equal(balance.ok, true);
assert.equal(balance.available[0].amountMinor, 624);
assert.equal(balance.available[1].amountMinor, null);
assert.equal(balance.pending[0].currency, "GBP");
assert.equal(balance.pending[0].amountMinor, 3878);
assert.notEqual(balance.available[1].amountMinor, 0);

const liveBalance = shapePlatformBalance({
  livemode: true,
  available: [{ currency: "gbp", amount: 999999 }],
  pending: [{ currency: "usd", amount: 1 }],
});
assert.equal(liveBalance.ok, false);
assert.equal(liveBalance.stripeCode, "mode_mismatch");
assert.equal(liveBalance.available, null);
assert.equal(liveBalance.pending, null);

const route = read("src/app/api/admin/usd-connect-settlement/route.ts");
const reader = read("src/lib/payments/payout-rail/usd-connect-settlement-read.ts");
assert.match(route, /requireAdmin/);
assert.match(route, /status === 401/);
assert.match(route, /status === 403/);
assert.match(route, /export async function GET/);
assert.doesNotMatch(route, /request\.json|searchParams|stripeChargeId|buyerId|sellerId/);
assert.match(reader, /getStripe\("TEST"\)/);
assert.doesNotMatch(reader, /getStripe\("LIVE"\)|stripeAccount/);
assert.match(reader, /stripeMode: "TEST"/);
assert.match(reader, /equals: "USD"/);
assert.match(reader, /payoutRail: "STRIPE_CONNECT"/);
assert.match(reader, /fundedAt: \{ not: null \}/);
assert.match(reader, /charges\.retrieve/);
assert.match(reader, /balance\.retrieve/);
assert.doesNotMatch(reader, /payouts\.create|quotes|transfers\.create|refunds\.create|accounts\.update|\.create\(|\.update\(|\.upsert\(|\.delete\(/);
assert.doesNotMatch(reader, /releaseFinal|releaseProcurement|reconcile|prepareQuote|prepareFunding|fundOne|coordinatePlatform/);
assert.doesNotMatch(route, /payouts\.create|charges\.create|balance\.retrieve/);

console.log("usd connect settlement tests passed");
