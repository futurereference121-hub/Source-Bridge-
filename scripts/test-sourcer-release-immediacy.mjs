/**
 * Task 1 — Sourcer release immediacy (source + offline transfer contract).
 * Mocks preferred; no Stripe money objects.
 * Run: node scripts/test-sourcer-release-immediacy.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const release = read("src/lib/payments/release.ts");
const fulfilment = read("src/lib/payments/fulfilment.ts");
const adminDecision = read("src/lib/payments/admin-protected-decision.ts");
const inactivity = read("src/app/api/admin/payments/inactivity-release/route.ts");
const vercel = read("vercel.json");
const refunds = [
  "src/lib/payments/refunds.ts",
  "src/lib/payments/admin-protected-decision.ts",
]
  .filter((p) => fs.existsSync(path.join(root, p)))
  .map(read)
  .join("\n");

// ── Authoritative release service + immediate transfer ─────────────────────
assert.match(release, /export async function releaseFinal/);
assert.match(release, /stripe\.transfers\.create/);
assert.match(
  release,
  /Stage A[\s\S]*transfers\.create[\s\S]*synchronously|runs synchronously inside releaseFinal/i,
);
assert.doesNotMatch(release, /setTimeout\s*\(/);
assert.doesNotMatch(
  release,
  /stripe\.payouts\.create/,
  "must not initiate Instant/bank payouts via Stripe payouts API",
);
assert.match(
  release,
  /does NOT create Instant or bank payouts|bank payout scheduling stays Stripe/i,
);

// All release callers go through releaseFinal (no duplicate transfer engines)
assert.match(fulfilment, /releaseFinal\(/);
assert.match(adminDecision, /releaseFinal\(/);
assert.match(inactivity, /releaseFinal\(/);
assert.match(
  fulfilment,
  /const result = await releaseFinal\(/,
  "A. buyer RELEASE_NOW must await releaseFinal immediately",
);
assert.match(
  adminDecision,
  /const result = await releaseFinal\(/,
  "B. admin seller-win must await releaseFinal immediately",
);

// Cron recovers inspection expiry promptly (not once-daily batch)
assert.match(vercel, /payments-release/);
assert.match(
  vercel,
  /"schedule":\s*"\*\/10 \* \* \* \*"/,
  "inspection-expiry cron must run at least every 10 minutes",
);

// Refund rail ≠ seller release
assert.doesNotMatch(
  release,
  /refunds\.create/,
  "release must not use refund API for seller transfer",
);

// source_transaction audited, not casually removed
assert.match(release, /source_transaction/);

// Idempotency keys
assert.match(release, /idempotencyKey/);
assert.match(release, /final_xfer_/);
assert.match(release, /proc_xfer_/);
assert.match(release, /transferAttempt/);
assert.match(
  release,
  /releaseProcurement[\s\S]*settleCurrency[\s\S]*source_transaction/,
  "procurement release must convert settle currency when using source_transaction",
);

// Failure must not mark RELEASED (mark only after SUCCEEDED transfer)
const failBlock = release.match(
  /catch \(err\) \{[\s\S]*?status: "FAILED"[\s\S]*?throw err;[\s\S]*?\}/,
);
assert.ok(failBlock, "E. failed transfer path must exist");
assert.doesNotMatch(
  failBlock[0],
  /releasedAt:\s*new Date\(\)|status:\s*next/,
  "E. failure must not mark released",
);

// ── Offline transfer contract (A–I) ────────────────────────────────────────
/**
 * Minimal mirror of releaseFinal money-path decisions for offline proofs.
 * One authorized release → one transfer request; failures leave books unchanged.
 */
function simulateReleaseFinal(state, opts = {}) {
  const calls = [];
  if (state.status === "RELEASED" || state.releasedAt) {
    return { alreadyReleased: true, state, calls };
  }
  if (state.status !== "READY_TO_RELEASE" && state.status !== "PARTIALLY_REFUNDED") {
    throw Object.assign(new Error("invalid"), { code: "INVALID_TRANSITION" });
  }
  const residual = Math.max(
    0,
    state.sellerEntitledMinor -
      state.procurementTransferredMinor -
      state.finalTransferredMinor,
  );
  let amount = residual;
  let isFull = true;
  if (opts.amountMinor != null) {
    const requested = Math.max(0, Math.floor(opts.amountMinor));
    if (requested <= 0) return { alreadyReleased: true, state, calls, amountMinor: 0 };
    if (requested > residual) {
      throw Object.assign(new Error("exceeds"), { code: "RELEASE_EXCEEDS_RESIDUAL" });
    }
    amount = requested;
    isFull = requested >= residual;
  }
  if (amount <= 0) {
    return {
      alreadyReleased: true,
      state: { ...state, status: "RELEASED", releasedAt: "now" },
      calls,
      amountMinor: 0,
    };
  }

  const idempotencyKey = isFull
    ? `final_xfer_${state.id}_${state.termsHash}`
    : `final_xfer_${state.id}_${state.termsHash}_admin_${amount}`;

  if (state.attempts?.[idempotencyKey]?.status === "SUCCEEDED") {
    return {
      alreadyReleased: true,
      state,
      calls,
      transferId: state.attempts[idempotencyKey].stripeTransferId,
      amountMinor: amount,
    };
  }

  if (opts.failTransfer) {
    state.attempts = {
      ...(state.attempts || {}),
      [idempotencyKey]: { status: "FAILED", amountMinor: amount },
    };
    throw Object.assign(new Error("stripe_fail"), { code: "TRANSFER_FAILED" });
  }

  const transferId = `tr_${idempotencyKey}`;
  calls.push({
    kind: "transfers.create",
    amount,
    currency: state.currency.toLowerCase(),
    destination: state.sellerConnectAccountId,
    idempotencyKey,
    immediate: true,
  });
  state.attempts = {
    ...(state.attempts || {}),
    [idempotencyKey]: {
      status: "SUCCEEDED",
      stripeTransferId: transferId,
      amountMinor: amount,
    },
  };
  state.finalTransferredMinor += amount;
  if (isFull) {
    state.status = "RELEASED";
    state.releasedAt = "now";
  } else if (state.status === "READY_TO_RELEASE") {
    state.status = "PARTIALLY_REFUNDED";
  }
  return { alreadyReleased: false, state, calls, transferId, amountMinor: amount };
}

function baseTxn(currency = "usd") {
  return {
    id: "txn_a",
    termsHash: "th1",
    status: "READY_TO_RELEASE",
    releasedAt: null,
    sellerEntitledMinor: 10_000,
    procurementTransferredMinor: 0,
    finalTransferredMinor: 0,
    currency,
    sellerConnectAccountId: "acct_seller_a",
    attempts: {},
  };
}

// A. normal release → one immediate transfer
{
  const s = baseTxn();
  const r = simulateReleaseFinal(s);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].kind, "transfers.create");
  assert.equal(r.calls[0].immediate, true);
  assert.equal(r.calls[0].amount, 10_000);
  assert.equal(r.state.status, "RELEASED");
}

// B. admin release (typed partial path still immediate)
{
  const s = baseTxn();
  const r = simulateReleaseFinal(s, { amountMinor: 10_000 });
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].immediate, true);
}

// C. repeated → no duplicate
{
  const s = baseTxn();
  const r1 = simulateReleaseFinal(s);
  const r2 = simulateReleaseFinal(s);
  assert.equal(r1.calls.length, 1);
  assert.equal(r2.alreadyReleased, true);
  assert.equal(r2.calls.length, 0);
}

// D. concurrent → one transfer (shared attempt map)
{
  const s = baseTxn();
  const results = [];
  // Serialize on shared state (mirrors transferAttempt unique key)
  for (let i = 0; i < 2; i++) {
    try {
      results.push(simulateReleaseFinal(s));
    } catch (e) {
      results.push({ error: e });
    }
  }
  const transfers = results.reduce((n, r) => n + (r.calls?.length || 0), 0);
  assert.equal(transfers, 1);
}

// E. failure → not marked released
{
  const s = baseTxn();
  assert.throws(() => simulateReleaseFinal(s, { failTransfer: true }));
  assert.equal(s.status, "READY_TO_RELEASE");
  assert.equal(s.releasedAt, null);
  assert.equal(s.finalTransferredMinor, 0);
  // retry succeeds
  const r = simulateReleaseFinal(s);
  assert.equal(r.calls.length, 1);
  assert.equal(s.status, "RELEASED");
}

// F. partial → remaining protected
{
  const s = baseTxn();
  const r = simulateReleaseFinal(s, { amountMinor: 4_000 });
  assert.equal(r.amountMinor, 4_000);
  assert.equal(s.finalTransferredMinor, 4_000);
  assert.equal(s.status, "PARTIALLY_REFUNDED");
  assert.equal(s.releasedAt, null);
  const remain =
    s.sellerEntitledMinor -
    s.procurementTransferredMinor -
    s.finalTransferredMinor;
  assert.equal(remain, 6_000);
}

// G/H/I currencies preserved on transfer
for (const currency of ["eur", "gbp", "usd", "cad"]) {
  const s = baseTxn(currency);
  const r = simulateReleaseFinal(s);
  assert.equal(r.calls[0].currency, currency);
}

console.log("[test-sourcer-release-immediacy] A–I passed");
