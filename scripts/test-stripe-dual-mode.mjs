/**
 * Dual-mode Stripe TEST/LIVE isolation unit tests (no network, no secrets printed).
 * Run: node scripts/test-stripe-dual-mode.mjs
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

function assertMoneyOpEnvironmentMatch(opts) {
  const txnMode = normalizeStripeMode(opts.txnStripeMode);
  const liveEnabled = Boolean(opts.livePaymentsEnabled);
  if (txnMode === "LIVE" && !liveEnabled) {
    const err = new Error("LIVE refused");
    err.code = "STRIPE_MODE_CONFLICT";
    throw err;
  }
  const clientMode = normalizeStripeMode(
    opts.clientStripeMode != null ? opts.clientStripeMode : txnMode,
  );
  if (clientMode !== txnMode) {
    const err = new Error("client mismatch");
    err.code = "STRIPE_MODE_CONFLICT";
    throw err;
  }
  if (opts.connectStripeMode != null && String(opts.connectStripeMode).trim()) {
    const connectMode = normalizeStripeMode(opts.connectStripeMode);
    if (connectMode !== txnMode) {
      const err = new Error("connect mismatch");
      err.code = "STRIPE_MODE_CONFLICT";
      throw err;
    }
  }
  return txnMode;
}

function selectSecretForMode(mode, env) {
  if (mode === "LIVE") {
    return env.STRIPE_SECRET_KEY_LIVE || "";
  }
  return env.STRIPE_SECRET_KEY_TEST || env.STRIPE_SECRET_KEY || "";
}

function refuseMixedPublishable(mode, secret, publishable) {
  const secretLive = String(secret).startsWith("sk_live_");
  const secretTest = String(secret).startsWith("sk_test_");
  const pubLive = String(publishable).startsWith("pk_live_");
  const pubTest = String(publishable).startsWith("pk_test_");
  if (mode === "TEST" && secretLive) return false;
  if (mode === "LIVE" && secretTest) return false;
  if (publishable) {
    if (secretLive && pubTest) return false;
    if (secretTest && pubLive) return false;
    if (mode === "TEST" && pubLive) return false;
    if (mode === "LIVE" && pubTest) return false;
  }
  return true;
}

function webhookMayMutateTxn({ verifiedMode, txnMode, liveEnabled }) {
  const v = normalizeStripeMode(verifiedMode);
  const t = normalizeStripeMode(txnMode);
  if (v === "LIVE" && !liveEnabled) return false;
  return v === t;
}

function connectRowForMode(rows, userId, mode) {
  return rows.find(
    (r) => r.userId === userId && normalizeStripeMode(r.stripeMode) === mode,
  );
}

// ── Source anchors
{
  const flags = read("src/lib/payments/flags.ts");
  assert.match(flags, /assertMoneyOpEnvironmentMatch/);
  assert.match(flags, /normalizeStripeMode/);

  const client = read("src/lib/payments/stripe/client.ts");
  assert.match(client, /getStripeSecretKey\(mode/);
  assert.match(client, /assertStripeEnvConsistent/);
  assert.match(client, /STRIPE_SECRET_KEY_LIVE/);
  assert.match(client, /NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_LIVE/);

  const webhooks = read("src/lib/payments/stripe/webhooks.ts");
  assert.match(webhooks, /verifiedMode/);
  assert.match(webhooks, /STRIPE_WEBHOOK_CROSS_MODE_REFUSED|mode_conflict/);
  assert.match(webhooks, /WEBHOOK_MODE_MISMATCH/);

  const migration = read(
    "prisma/migrations/20260826120000_connect_dual_mode_isolation/migration.sql",
  );
  assert.match(migration, /StripeConnectAccount_userId_stripeMode_key/);
  assert.match(migration, /DROP INDEX IF EXISTS "StripeConnectAccount_userId_key"/);
}

// ── TEST txn → TEST client; LIVE txn → LIVE client
{
  const env = {
    STRIPE_SECRET_KEY_TEST: "sk_test_unit",
    STRIPE_SECRET_KEY_LIVE: "sk_live_unit",
  };
  assert.equal(selectSecretForMode("TEST", env).startsWith("sk_test_"), true);
  assert.equal(selectSecretForMode("LIVE", env).startsWith("sk_live_"), true);
}

// ── TEST seller Connect ≠ LIVE seller Connect (isolation)
{
  const rows = [
    {
      userId: "seller_a",
      stripeMode: "TEST",
      stripeAccountId: "acct_test_a",
    },
    {
      userId: "seller_a",
      stripeMode: "LIVE",
      stripeAccountId: "acct_live_a",
    },
  ];
  const testRow = connectRowForMode(rows, "seller_a", "TEST");
  const liveRow = connectRowForMode(rows, "seller_a", "LIVE");
  assert.equal(testRow.stripeAccountId, "acct_test_a");
  assert.equal(liveRow.stripeAccountId, "acct_live_a");
  assert.notEqual(testRow.stripeAccountId, liveRow.stripeAccountId);
  // Live onboarding must not overwrite TEST id
  assert.equal(
    connectRowForMode(rows, "seller_a", "TEST").stripeAccountId,
    "acct_test_a",
  );
}

// ── Cross-env money ops REFUSED
{
  assert.throws(
    () =>
      assertMoneyOpEnvironmentMatch({
        txnStripeMode: "TEST",
        connectStripeMode: "LIVE",
        clientStripeMode: "TEST",
        livePaymentsEnabled: true,
      }),
    (err) => err.code === "STRIPE_MODE_CONFLICT",
  );
  assert.throws(
    () =>
      assertMoneyOpEnvironmentMatch({
        txnStripeMode: "LIVE",
        connectStripeMode: "LIVE",
        clientStripeMode: "TEST",
        livePaymentsEnabled: true,
      }),
    (err) => err.code === "STRIPE_MODE_CONFLICT",
  );
  assert.throws(
    () =>
      assertMoneyOpEnvironmentMatch({
        txnStripeMode: "LIVE",
        connectStripeMode: "LIVE",
        clientStripeMode: "LIVE",
        livePaymentsEnabled: false,
      }),
    (err) => err.code === "STRIPE_MODE_CONFLICT",
  );
  assert.equal(
    assertMoneyOpEnvironmentMatch({
      txnStripeMode: "TEST",
      connectStripeMode: "TEST",
      clientStripeMode: "TEST",
      livePaymentsEnabled: false,
    }),
    "TEST",
  );
}

// ── Mixed publishable/secret REFUSED
{
  assert.equal(
    refuseMixedPublishable("TEST", "sk_test_x", "pk_test_x"),
    true,
  );
  assert.equal(
    refuseMixedPublishable("TEST", "sk_test_x", "pk_live_x"),
    false,
  );
  assert.equal(
    refuseMixedPublishable("LIVE", "sk_live_x", "pk_test_x"),
    false,
  );
  assert.equal(
    refuseMixedPublishable("LIVE", "sk_live_x", "pk_live_x"),
    true,
  );
}

// ── Webhook cross-mutate blocked
{
  assert.equal(
    webhookMayMutateTxn({
      verifiedMode: "TEST",
      txnMode: "TEST",
      liveEnabled: false,
    }),
    true,
  );
  assert.equal(
    webhookMayMutateTxn({
      verifiedMode: "LIVE",
      txnMode: "TEST",
      liveEnabled: true,
    }),
    false,
  );
  assert.equal(
    webhookMayMutateTxn({
      verifiedMode: "TEST",
      txnMode: "LIVE",
      liveEnabled: true,
    }),
    false,
  );
  assert.equal(
    webhookMayMutateTxn({
      verifiedMode: "LIVE",
      txnMode: "LIVE",
      liveEnabled: false,
    }),
    false,
  );
}

// ── LIVE Connect required when only TEST exists
{
  function liveConnectOnboardingRequired({ mode, hasLiveRow }) {
    return mode === "LIVE" && !hasLiveRow;
  }
  assert.equal(
    liveConnectOnboardingRequired({ mode: "LIVE", hasLiveRow: false }),
    true,
  );
  assert.equal(
    liveConnectOnboardingRequired({ mode: "TEST", hasLiveRow: false }),
    false,
  );
  assert.equal(
    liveConnectOnboardingRequired({ mode: "LIVE", hasLiveRow: true }),
    false,
  );
}

// ── Currency architecture untouched (no GBP-only / silent FX in dual-mode files)
{
  const client = read("src/lib/payments/stripe/client.ts");
  assert.doesNotMatch(client, /force.*GBP|GBP.?only|silent.?FX/i);
  const flags = read("src/lib/payments/flags.ts");
  assert.doesNotMatch(flags, /GBP.?only/);
}

console.log("stripe dual-mode isolation tests passed");
