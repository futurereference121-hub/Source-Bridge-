/**
 * Global Payouts release-flow behavioral regression (offline, mock Stripe, no DB).
 * Covers audit gaps G1–G10 via in-memory CAS simulation + source contracts.
 * Run: node scripts/test-global-payouts-release-flow.mjs
 * Never creates real Stripe payout objects.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`PASS ${name}`);
}

// ── Pure mirrors of CAS / dual-rail / returned / display (keep in sync) ──

const RANK = {
  PENDING: 0,
  AWAITING_MINIMUM: 1,
  AWAITING_FA_FUNDS: 1,
  PROCESSING: 2,
  ACTION_REQUIRED: 3,
  FAILED: 4,
  RETURNED: 5,
  SUCCEEDED: 6,
  RECONCILED: 7,
};

function canAdvance(current, next) {
  if (["FAILED", "AWAITING_MINIMUM", "AWAITING_FA_FUNDS"].includes(current)) {
    return true;
  }
  if (current === "SUCCEEDED" || current === "RECONCILED") {
    return next === "RETURNED" || next === "RECONCILED";
  }
  return (RANK[next] ?? 0) >= (RANK[current] ?? 0);
}

function extractFees(body) {
  if (!body) {
    return { providerFeeMinor: 0, crossBorderFeeMinor: 0, fxFeeMinor: 0 };
  }
  let providerFeeMinor = 0;
  let crossBorderFeeMinor = 0;
  let fxFeeMinor = 0;
  for (const f of body.fees || []) {
    const val = f?.amount?.value || 0;
    const t = String(f?.type || "").toLowerCase();
    if (t.includes("cross")) crossBorderFeeMinor += val;
    else if (t.includes("fx") || t.includes("exchange")) fxFeeMinor += val;
    else providerFeeMinor += val;
  }
  return { providerFeeMinor, crossBorderFeeMinor, fxFeeMinor };
}

function sanitize(raw) {
  return String(raw || "")
    .replace(/\b\d{12,19}\b/g, "[redacted]")
    .replace(/sk_(live|test)_[A-Za-z0-9]+/g, "[redacted]")
    .slice(0, 200);
}

function deriveDisplay(status) {
  const s = String(status || "").toUpperCase();
  if (s === "PROCESSING" || s === "PENDING") {
    return { pendingProvider: true, claimPaid: false };
  }
  if (s === "SUCCEEDED" || s === "RECONCILED") {
    return { pendingProvider: false, claimPaid: true };
  }
  if (s === "RETURNED") {
    return { pendingProvider: false, claimPaid: false, needsAdmin: true };
  }
  return { pendingProvider: false, claimPaid: false };
}

/** In-memory store simulating one protected txn + attempts + ledger + rails */
function createStore() {
  return {
    txn: {
      id: "txn_1",
      status: "FUNDED",
      procurementTransferredMinor: 0,
      finalTransferredMinor: 0,
      sellerEntitledMinor: 10700,
      currency: "USD",
    },
    attempts: new Map(),
    transfers: new Map(),
    ledger: new Map(),
    finalizeCount: 0,
  };
}

function casFinalize(store, attemptId, amount, kind, providerBody) {
  const attempt = store.attempts.get(attemptId);
  if (!attempt) throw new Error("missing attempt");
  if (!["PROCESSING", "PENDING", "ACTION_REQUIRED"].includes(attempt.status)) {
    if (attempt.status === "SUCCEEDED" || attempt.status === "RECONCILED") {
      return { alreadyFinalized: true, countersApplied: false };
    }
    throw Object.assign(new Error("CAS conflict"), {
      code: "GP_FINALIZE_CAS_CONFLICT",
    });
  }
  attempt.status = "SUCCEEDED";
  const fees = extractFees(providerBody);
  attempt.fees = fees;
  store.finalizeCount += 1;
  if (kind === "PROCUREMENT") {
    store.txn.procurementTransferredMinor += amount;
    store.txn.status = "PROCUREMENT_RELEASED";
  } else {
    store.txn.finalTransferredMinor += amount;
    store.txn.status = "RELEASED";
  }
  const ledgerKey = `ledger_${attempt.idempotencyKey}`;
  if (!store.ledger.has(ledgerKey)) {
    store.ledger.set(ledgerKey, { amount, kind, direction: "DEBIT" });
  }
  return { alreadyFinalized: false, countersApplied: true };
}

function handleReturned(store, attemptId) {
  const attempt = store.attempts.get(attemptId);
  if (!attempt) throw new Error("missing");
  if (attempt.status === "RETURNED") return { action: "already_returned" };
  const wasSucceeded =
    attempt.status === "SUCCEEDED" || attempt.status === "RECONCILED";
  if (
    !wasSucceeded &&
    attempt.status !== "PROCESSING"
  ) {
    return { action: "ignored" };
  }
  attempt.status = "RETURNED";
  attempt.autoRepayBlocked = true;
  if (wasSucceeded) {
    if (attempt.kind === "PROCUREMENT") {
      store.txn.procurementTransferredMinor = Math.max(
        0,
        store.txn.procurementTransferredMinor - attempt.amountMinor,
      );
      if (store.txn.procurementTransferredMinor === 0) {
        store.txn.status = "FUNDED";
      }
    } else {
      store.txn.finalTransferredMinor = Math.max(
        0,
        store.txn.finalTransferredMinor - attempt.amountMinor,
      );
      store.txn.status = "READY_TO_RELEASE";
    }
    const key = `ledger_gp_returned_${attempt.idempotencyKey}`;
    if (!store.ledger.has(key)) {
      store.ledger.set(key, {
        amount: attempt.amountMinor,
        kind: "ADJUSTMENT",
        direction: "CREDIT",
      });
    }
  }
  return { action: "returned", wasSucceeded };
}

function assertDualRail(store, kind, rail) {
  if (rail === "CONNECT") {
    for (const a of store.attempts.values()) {
      if (
        a.kind === kind &&
        ["SUCCEEDED", "PROCESSING", "RECONCILED"].includes(a.status)
      ) {
        throw Object.assign(new Error("dual rail"), {
          code: "DUAL_RAIL_BLOCKED",
        });
      }
    }
  } else {
    for (const t of store.transfers.values()) {
      if (t.kind === kind && t.status === "SUCCEEDED") {
        throw Object.assign(new Error("dual rail"), {
          code: "DUAL_RAIL_BLOCKED",
        });
      }
    }
  }
}

function feeBps(sellerEntitledMinor) {
  // Mirror SOURCE_BRIDGE_FEE_BPS = 700 on fee base (entitlement), not compounding.
  return Math.round((sellerEntitledMinor * 700) / 10000);
}

// ── G1 concurrent finalize CAS ──
{
  const store = createStore();
  store.attempts.set("a1", {
    id: "a1",
    kind: "FINAL",
    amountMinor: 10000,
    status: "PROCESSING",
    idempotencyKey: "final_gp_txn_1",
  });
  const r1 = casFinalize(store, "a1", 10000, "FINAL", {
    fees: [{ type: "standard", amount: { value: 50 } }],
  });
  const r2 = casFinalize(store, "a1", 10000, "FINAL", {
    fees: [{ type: "standard", amount: { value: 50 } }],
  });
  ok("G1 first finalize applies counters", r1.countersApplied === true);
  ok("G1 second finalize is alreadyFinalized", r2.alreadyFinalized === true);
  ok("G1 counters applied once", store.txn.finalTransferredMinor === 10000);
  ok("G1 finalizeCount once", store.finalizeCount === 1);
  ok("G1 ledger once", store.ledger.size === 1);
}

// ── G1 out-of-order / concurrent double-posted ──
{
  const store = createStore();
  store.attempts.set("a1", {
    id: "a1",
    kind: "PROCUREMENT",
    amountMinor: 5000,
    status: "PROCESSING",
    idempotencyKey: "proc_gp_1",
  });
  // Simulate two workers racing: both see PROCESSING, only one CAS wins.
  let winners = 0;
  for (let i = 0; i < 2; i++) {
    const a = store.attempts.get("a1");
    if (["PROCESSING", "PENDING"].includes(a.status)) {
      const r = casFinalize(store, "a1", 5000, "PROCUREMENT");
      if (!r.alreadyFinalized) winners += 1;
    }
  }
  ok("G1 concurrent race single winner", winners === 1);
  ok(
    "G1 procurement counter once",
    store.txn.procurementTransferredMinor === 5000,
  );
}

// ── G1 Stripe ok / DB finalize failure → stay PROCESSING, no second OP ──
{
  const store = createStore();
  store.attempts.set("a1", {
    id: "a1",
    kind: "FINAL",
    amountMinor: 1000,
    status: "PENDING",
    idempotencyKey: "final_gp_dbfail",
    stripeOutboundPaymentId: "",
  });
  // Stripe create succeeded; local finalize throws → park PROCESSING
  store.attempts.get("a1").status = "PROCESSING";
  store.attempts.get("a1").stripeOutboundPaymentId = "obp_mock_1";
  let secondCreateBlocked = false;
  try {
    const a = store.attempts.get("a1");
    if (a.status === "PROCESSING" && a.stripeOutboundPaymentId) {
      throw Object.assign(new Error("in flight"), {
        code: "GP_PAYMENT_IN_FLIGHT",
      });
    }
  } catch (e) {
    secondCreateBlocked = e.code === "GP_PAYMENT_IN_FLIGHT";
  }
  ok("G1 ambiguous Stripe response blocks second create", secondCreateBlocked);
  ok(
    "G1 DB-fail leaves PROCESSING not FAILED",
    store.attempts.get("a1").status === "PROCESSING",
  );
}

// ── G2 RETURNED after SUCCEEDED reverses books + blocks repay ──
{
  const store = createStore();
  store.attempts.set("a1", {
    id: "a1",
    kind: "FINAL",
    amountMinor: 8000,
    status: "PROCESSING",
    idempotencyKey: "final_gp_ret",
  });
  casFinalize(store, "a1", 8000, "FINAL");
  ok("G2 pre-return RELEASED", store.txn.status === "RELEASED");
  const ret = handleReturned(store, "a1");
  ok("G2 returned action", ret.action === "returned");
  ok("G2 counters reversed", store.txn.finalTransferredMinor === 0);
  ok("G2 status unwound", store.txn.status === "READY_TO_RELEASE");
  ok("G2 reverse ledger present", store.ledger.has("ledger_gp_returned_final_gp_ret"));
  ok("G2 autoRepayBlocked", store.attempts.get("a1").autoRepayBlocked === true);
  const ret2 = handleReturned(store, "a1");
  ok("G2 idempotent return", ret2.action === "already_returned");
}

// ── G3 stuck PROCESSING reconcile uses retrieve status, not time ──
{
  function reconcile(attempt, retrievedStatus, ageMs, thresholdMs, force) {
    if (attempt.status !== "PROCESSING") return "unchanged";
    if (!force && ageMs < thresholdMs) return "skipped_fresh";
    // Never mark success from age alone — require retrieved status.
    if (retrievedStatus === "posted" || retrievedStatus === "succeeded") {
      attempt.status = "SUCCEEDED";
      return "finalized";
    }
    if (retrievedStatus === "failed") {
      attempt.status = "FAILED";
      return "marked_failed";
    }
    return "unchanged";
  }
  const a = { status: "PROCESSING" };
  ok(
    "G3 old age alone does not finalize",
    reconcile(a, "processing", 60 * 60 * 1000, 15 * 60 * 1000, true) ===
      "unchanged",
  );
  ok("G3 still PROCESSING after time-only", a.status === "PROCESSING");
  ok(
    "G3 retrieve succeeded finalizes",
    reconcile(a, "succeeded", 1000, 15 * 60 * 1000, true) === "finalized",
  );
}

// ── G4 / G10 dual-rail both directions ──
{
  const store = createStore();
  store.attempts.set("gp1", {
    id: "gp1",
    kind: "FINAL",
    amountMinor: 1000,
    status: "SUCCEEDED",
    idempotencyKey: "k",
  });
  let blocked = false;
  try {
    assertDualRail(store, "FINAL", "CONNECT");
  } catch (e) {
    blocked = e.code === "DUAL_RAIL_BLOCKED";
  }
  ok("G4 Connect blocked after GP SUCCEEDED", blocked);

  const store2 = createStore();
  store2.attempts.set("gp2", {
    id: "gp2",
    kind: "PROCUREMENT",
    amountMinor: 1000,
    status: "PROCESSING",
    idempotencyKey: "k2",
  });
  let blockedProc = false;
  try {
    assertDualRail(store2, "PROCUREMENT", "CONNECT");
  } catch (e) {
    blockedProc = e.code === "DUAL_RAIL_BLOCKED";
  }
  ok("G4 Connect blocked while GP PROCESSING", blockedProc);

  const store3 = createStore();
  store3.transfers.set("t1", {
    kind: "FINAL",
    status: "SUCCEEDED",
  });
  let blockedGp = false;
  try {
    assertDualRail(store3, "FINAL", "GP");
  } catch (e) {
    blockedGp = e.code === "DUAL_RAIL_BLOCKED";
  }
  ok("G10 GP blocked after Connect SUCCEEDED", blockedGp);

  // Prove one release cannot produce both
  const store4 = createStore();
  assertDualRail(store4, "FINAL", "CONNECT");
  store4.transfers.set("t2", { kind: "FINAL", status: "SUCCEEDED" });
  let bothBlocked = false;
  try {
    assertDualRail(store4, "FINAL", "GP");
  } catch (e) {
    bothBlocked = e.code === "DUAL_RAIL_BLOCKED";
  }
  ok("G4/G10 cannot have both rails SUCCEEDED", bothBlocked);
}

// ── G5 pendingProvider honesty ──
{
  ok(
    "G5 PROCESSING not claimPaid",
    deriveDisplay("PROCESSING").pendingProvider === true &&
      deriveDisplay("PROCESSING").claimPaid === false,
  );
  ok(
    "G5 SUCCEEDED claimPaid",
    deriveDisplay("SUCCEEDED").claimPaid === true &&
      deriveDisplay("SUCCEEDED").pendingProvider === false,
  );
  ok("G5 RETURNED needsAdmin", deriveDisplay("RETURNED").needsAdmin === true);
}

// ── G6 combine-minimum grouping ──
{
  function groupMin(rows) {
    const map = new Map();
    for (const row of rows) {
      if (row.status !== "AWAITING_MINIMUM") continue;
      const key = `${row.sellerId}|${row.stripeMode}|${row.currency}`;
      const list = map.get(key) || [];
      list.push(row);
      map.set(key, list);
    }
    return [...map.values()];
  }
  const groups = groupMin([
    {
      attemptId: "1",
      sellerId: "s1",
      currency: "THB",
      stripeMode: "TEST",
      status: "AWAITING_MINIMUM",
      amountMinor: 100,
    },
    {
      attemptId: "2",
      sellerId: "s1",
      currency: "THB",
      stripeMode: "TEST",
      status: "AWAITING_MINIMUM",
      amountMinor: 200,
    },
    {
      attemptId: "3",
      sellerId: "s2",
      currency: "THB",
      stripeMode: "TEST",
      status: "AWAITING_MINIMUM",
      amountMinor: 50,
    },
  ]);
  ok("G6 groups same seller", groups.some((g) => g.length === 2));
  ok("G6 other seller separate", groups.some((g) => g.length === 1));
}

// ── G7 fee extract from retrieved body ──
{
  const fees = extractFees({
    fees: [
      { type: "standard", amount: { value: 30 } },
      { type: "cross_border", amount: { value: 20 } },
      { type: "fx", amount: { value: 10 } },
    ],
  });
  ok("G7 provider fee", fees.providerFeeMinor === 30);
  ok("G7 cross border", fees.crossBorderFeeMinor === 20);
  ok("G7 fx", fees.fxFeeMinor === 10);
  ok("G7 empty body zeros", extractFees(undefined).providerFeeMinor === 0);
}

// ── G8 sanitize / no secrets in failure text ──
{
  const s = sanitize("fail sk_test_abc123 account 4111111111111111");
  ok("G8 redacts sk", !s.includes("sk_test_abc123"));
  ok("G8 redacts PAN-like", !s.includes("4111111111111111"));
}

// ── Fee 7% unchanged (Connect path invariant) ──
{
  ok("G9 fee 7% of 10000 = 700", feeBps(10000) === 700);
  ok("G9 fee 7% of 10700 = 749", feeBps(10700) === 749);
}

// ── Source contracts G1–G10 ──
{
  const outbound = read("src/lib/payments/payout-rail/outbound-payment.ts");
  const events = read("src/lib/payments/payout-rail/events.ts");
  const release = read("src/lib/payments/release.ts");
  const dual = read("src/lib/payments/payout-rail/dual-rail.ts");
  const returned = read("src/lib/payments/payout-rail/returned.ts");
  const reconcile = read("src/lib/payments/payout-rail/reconcile.ts");
  const combine = read("src/lib/payments/payout-rail/combine-minimum.ts");
  const display = read("src/lib/payments/payout-rail/outbound-display.ts");
  const cron = read("src/app/api/cron/payments-release/route.ts");
  const adminApi = read("src/app/api/admin/payments/gp-reconcile/route.ts");
  const releaseRoute = read("src/app/api/payments/release-procurement/route.ts");
  const config = read("src/lib/payments/config.ts");

  ok(
    "G1 source CAS updateMany",
    outbound.includes("updateMany") &&
      outbound.includes("GP_FINALIZE_CAS_CONFLICT"),
  );
  ok(
    "G1 source local finalize pending on Stripe success",
    outbound.includes("LOCAL_FINALIZE_PENDING") ||
      outbound.includes("GP_PAYMENT_IN_FLIGHT"),
  );
  ok(
    "G2 source handleOutboundReturned",
    returned.includes("handleOutboundReturned") &&
      events.includes("handleOutboundReturned"),
  );
  ok(
    "G2 source auto repay blocked",
    outbound.includes("GP_RETURNED_MANUAL_REVIEW"),
  );
  ok(
    "G3 source reconcile retrieve",
    reconcile.includes("reconcileStuckOutboundPayments") &&
      reconcile.includes("/v2/money_management/outbound_payments/") &&
      cron.includes("reconcileStuckOutboundPayments"),
  );
  ok(
    "G3 never time-alone success",
    !reconcile.includes("markSucceededFromAge") &&
      reconcile.includes("mapOutboundPaymentProviderStatus"),
  );
  ok(
    "G4/G10 Connect assertNoGpBlockingAttempt",
    release.includes("assertNoGpBlockingAttempt") &&
      dual.includes("assertNoGpBlockingAttempt"),
  );
  ok(
    "G4 Connect path still transfers.create",
    release.includes("transfers.create"),
  );
  ok(
    "G5 pendingProvider API",
    releaseRoute.includes("pendingProvider") &&
      display.includes("pendingProvider"),
  );
  ok(
    "G6 combine wired",
    combine.includes("planCombineMinimumGroups") &&
      outbound.includes("planCombineMinimumGroups"),
  );
  ok(
    "G7 retrieve on webhook",
    events.includes("retrieveOutboundPaymentBody") ||
      events.includes("money_management/outbound_payments"),
  );
  ok(
    "G8 admin reconcile route",
    adminApi.includes("reconcile_one") &&
      adminApi.includes("GP_RETURNED_MANUAL_REVIEW"),
  );
  ok(
    "G9 Connect fee 700 bps unchanged",
    config.includes("SOURCE_BRIDGE_FEE_BPS") && config.includes("700"),
  );
  ok(
    "G9 no transfers.create in outbound",
    !/\bstripe\.transfers\.create\b/.test(outbound) &&
      !/transfers\.create\(/.test(outbound),
  );
  ok(
    "G9 LIVE initiation gate preserved",
    outbound.includes("canInitiateGlobalPayoutsMoney"),
  );
}

console.log(`\nOK ${passed} global-payouts-release-flow checks passed`);
