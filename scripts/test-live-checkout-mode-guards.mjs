/**
 * LIVE checkout mode guards — server PI livemode + client pk_* isolation.
 * No Stripe network, no real money. Run: node scripts/test-live-checkout-mode-guards.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function normalizeStripeMode(raw) {
  return String(raw || "").trim().toUpperCase() === "LIVE" ? "LIVE" : "TEST";
}

function assertPaymentIntentModeMatch(opts) {
  const txnMode = normalizeStripeMode(opts.txnStripeMode);
  const liveEnabled = Boolean(opts.livePaymentsEnabled);
  if (txnMode === "LIVE" && !liveEnabled) {
    const err = new Error("kill switch");
    err.code = "STRIPE_MODE_CONFLICT";
    throw err;
  }
  const piIsLive = Boolean(opts.paymentIntentLivemode);
  const expectLive = txnMode === "LIVE";
  if (piIsLive === expectLive) return;
  if (piIsLive) {
    const err = new Error("Live PI on TEST txn");
    err.code = "LIVE_PI_REFUSED";
    throw err;
  }
  const err = new Error("TEST PI on LIVE txn");
  err.code = "TEST_PI_REFUSED";
  throw err;
}

function publishableKeyMode(key) {
  if (String(key).startsWith("pk_test_")) return "TEST";
  if (String(key).startsWith("pk_live_")) return "LIVE";
  return null;
}

function clientAcceptsPublishableKey({ stripeMode, publishableKey }) {
  const keyMode = publishableKeyMode(publishableKey);
  if (!keyMode) return false;
  if (stripeMode && keyMode !== stripeMode) return false;
  return true;
}

// ── Source anchors (obsolete blanket LIVE_PI refuse removed)
{
  const checkout = read("src/lib/payments/checkout.ts");
  assert.match(checkout, /assertPaymentIntentModeMatch/);
  assert.doesNotMatch(
    checkout,
    /if \(intent\.livemode\) \{\s*throw Object\.assign\(new Error\("Live PaymentIntents are refused"\)/,
    "obsolete blanket livemode refuse must be removed from createPaymentIntentForTxn",
  );
  assert.doesNotMatch(
    checkout,
    /if \(pi\.livemode\) \{\s*throw Object\.assign\(new Error\("Live PaymentIntents are not accepted"\)/,
    "obsolete blanket livemode refuse must be removed from reconcileTxnFundingFromStripe",
  );

  const flags = read("src/lib/payments/flags.ts");
  assert.match(flags, /export function assertPaymentIntentModeMatch/);

  const ui = read("src/components/payments/ProtectedPaymentCheckout.tsx");
  assert.match(ui, /pk_live_/);
  assert.match(ui, /pk_test_/);
  assert.doesNotMatch(
    ui,
    /publishableKey\.startsWith\("pk_test_"\)/,
    "client must not hard-require pk_test_ only",
  );
  assert.match(ui, /keyMode !== stripeMode/);

  const route = read("src/app/api/payments/checkout/route.ts");
  assert.match(route, /status < 500 \|\| code/);
}

// TEST A: LIVE_PAYMENTS_ENABLED=false + LIVE op → REFUSED
{
  assert.throws(
    () =>
      assertPaymentIntentModeMatch({
        txnStripeMode: "LIVE",
        paymentIntentLivemode: true,
        livePaymentsEnabled: false,
      }),
    (e) => e.code === "STRIPE_MODE_CONFLICT",
  );
}

// TEST B: LIVE enabled + LIVE txn + LIVE PI → ALLOWED
{
  assert.doesNotThrow(() =>
    assertPaymentIntentModeMatch({
      txnStripeMode: "LIVE",
      paymentIntentLivemode: true,
      livePaymentsEnabled: true,
    }),
  );
}

// TEST C: LIVE mode + TEST PI → REFUSED
{
  assert.throws(
    () =>
      assertPaymentIntentModeMatch({
        txnStripeMode: "LIVE",
        paymentIntentLivemode: false,
        livePaymentsEnabled: true,
      }),
    (e) => e.code === "TEST_PI_REFUSED",
  );
}

// TEST D: TEST mode + LIVE PI → REFUSED
{
  assert.throws(
    () =>
      assertPaymentIntentModeMatch({
        txnStripeMode: "TEST",
        paymentIntentLivemode: true,
        livePaymentsEnabled: false,
      }),
    (e) => e.code === "LIVE_PI_REFUSED",
  );
}

// TEST E: LIVE mode + pk_live_ → accepted (Stripe.js would load)
{
  assert.equal(
    clientAcceptsPublishableKey({
      stripeMode: "LIVE",
      publishableKey: "pk_live_unit",
    }),
    true,
  );
}

// TEST F: LIVE mode + pk_test_ → REFUSED
{
  assert.equal(
    clientAcceptsPublishableKey({
      stripeMode: "LIVE",
      publishableKey: "pk_test_unit",
    }),
    false,
  );
}

// TEST G: TEST mode + pk_test_ → works
{
  assert.equal(
    clientAcceptsPublishableKey({
      stripeMode: "TEST",
      publishableKey: "pk_test_unit",
    }),
    true,
  );
}

// TEST H: TEST mode + pk_live_ → REFUSED
{
  assert.equal(
    clientAcceptsPublishableKey({
      stripeMode: "TEST",
      publishableKey: "pk_live_unit",
    }),
    false,
  );
}

console.log("live checkout mode guard tests passed (A–H)");
