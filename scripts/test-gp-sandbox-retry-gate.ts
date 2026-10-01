/**
 * Mocked gate for the Preview corrected-retry entry. No Stripe and no database.
 * Run: node --experimental-strip-types scripts/test-gp-sandbox-retry-gate.ts
 */
import assert from "node:assert/strict";
import { isExactCorrectedRetryFixture } from "../src/lib/payments/payout-rail/preview-sandbox-retry-gate.ts";

let passed = 0;
function ok(name: string, cond: unknown) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`PASS ${name}`);
}

const exact = {
  hostH8: "bf232aa9",
  txnH8: "7162e1e3",
  txnStatus: "READY_TO_RELEASE",
  stripeMode: "TEST",
  attemptCount: 1,
  attemptH8: "d69014c5",
  attemptStatus: "FAILED",
  hasOutboundPaymentId: false,
  listedOutboundCount: 0,
};

ok("exact fixture selects corrected retry", isExactCorrectedRetryFixture(exact) === true);
ok("wrong transaction does not select retry", isExactCorrectedRetryFixture({ ...exact, txnH8: "aaaaaaaa" }) === false);
ok("wrong attempt does not select retry", isExactCorrectedRetryFixture({ ...exact, attemptH8: "bbbbbbbb" }) === false);
ok("wrong database does not select retry", isExactCorrectedRetryFixture({ ...exact, hostH8: "bb36cc34" }) === false);
ok("live mode does not select retry", isExactCorrectedRetryFixture({ ...exact, stripeMode: "LIVE" }) === false);
ok("stored outbound id does not select retry", isExactCorrectedRetryFixture({ ...exact, hasOutboundPaymentId: true }) === false);
ok("unlisted provider count does not select retry", isExactCorrectedRetryFixture({ ...exact, listedOutboundCount: null }) === false);
ok("a second attempt does not select retry", isExactCorrectedRetryFixture({ ...exact, attemptCount: 2 }) === false);
ok("non-failed attempt does not select retry", isExactCorrectedRetryFixture({ ...exact, attemptStatus: "PENDING" }) === false);

console.log(`\n${passed} passed`);
