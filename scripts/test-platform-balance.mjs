/**
 * Platform balance coordination. No Stripe network and no payout.
 * Run: node scripts/test-platform-balance.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

if (process.env.SB_PLATFORM_BALANCE_TEST !== "1") {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/SECRET|TOKEN|KEY|DATABASE|POSTGRES|NEON|STRIPE|PASSWORD|COOKIE|AUTH/i.test(key)) {
      delete env[key];
    }
  }
  env.SB_PLATFORM_BALANCE_TEST = "1";
  env.NODE_ENV = "test";
  const result = spawnSync(process.execPath, ["--experimental-strip-types", fileURLToPath(import.meta.url)], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

const balance = await import(pathToFileURL(path.join(root, "src/lib/payments/payout-rail/platform-balance.ts")).href);
const funding = await import(pathToFileURL(path.join(root, "src/lib/payments/payout-rail/proceeds-funding.ts")).href);
const flags = await import(pathToFileURL(path.join(root, "src/lib/payments/flags.ts")).href);

const {
  PLATFORM_BALANCE_LOCK_STALE_MS,
  STRIPE_IDEMPOTENCY_WINDOW_MS,
  bankRemainderIdempotencyKey,
  classifyStripeReadFailure,
  DASHBOARD_SCHEDULE_LIMIT,
  dailyScheduleRollbackDecision,
  evaluateModeReadiness,
  lockAcquisition,
  manualScheduleCutoverDecision,
  nextBankRemainderAttempt,
  planSafeBankRemainder,
  platformBalanceHealth,
  readinessHeartbeatForMode,
  reservePurchase,
  resumeWorkerAfterTakeover,
  selectVerifiedPlatformBank,
  sharedScheduleCutover,
} = balance;
const { decideFundingRequest, completedPurchaseBlocksNewFunding, fundingScanIncludesPurchase } = funding;
const {
  isPlatformBankRemainderPayoutEnabled,
  isPlatformBalanceReadinessEnabled,
  isGlobalPayoutsProceedsFundingEnabled,
} = flags;

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

function gpPurchase(overrides = {}) {
  return {
    stripeMode: "TEST",
    currency: "GBP",
    payoutRail: "STRIPE_GLOBAL_PAYOUTS",
    paymentOption: "PROTECTED",
    status: "READY_TO_RELEASE",
    sellerEntitlementMinor: 3500,
    transferredMinor: 0,
    protectionFeeMinor: 525,
    platformFeeRefundedMinor: 0,
    totalChargeMinor: 4025,
    refundedMinor: 0,
    openDispute: false,
    chargeNetMinor: 3878,
    durablyCreditedMinor: 0,
    outboundStatuses: ["AWAITING_FA_FUNDS"],
    pendingTransferMinor: 0,
    pendingFundingMinor: 0,
    ...overrides,
  };
}

function connectPurchase(overrides = {}) {
  return {
    stripeMode: "TEST",
    currency: "GBP",
    payoutRail: "STRIPE_CONNECT",
    paymentOption: "PROTECTED",
    status: "FUNDED",
    sellerEntitlementMinor: 5000,
    transferredMinor: 0,
    protectionFeeMinor: 350,
    platformFeeRefundedMinor: 0,
    totalChargeMinor: 5350,
    refundedMinor: 0,
    openDispute: false,
    chargeNetMinor: null,
    durablyCreditedMinor: 0,
    outboundStatuses: [],
    pendingTransferMinor: 0,
    pendingFundingMinor: 0,
    ...overrides,
  };
}

function plan(overrides = {}) {
  return planSafeBankRemainder({
    mode: "TEST",
    currency: "GBP",
    bankEnabled: true,
    scheduleInterval: "manual",
    availableMinor: 20000,
    destinationReady: true,
    uncertainBankAttempt: false,
    inflightBankMinor: 0,
    purchases: [],
    scanComplete: true,
    ...overrides,
  });
}

process.env.PLATFORM_BANK_REMAINDER_PAYOUT_ENABLED = "";
process.env.PLATFORM_BANK_REMAINDER_PAYOUT_LIVE_ENABLED = "";
process.env.PLATFORM_BALANCE_READINESS_TEST_ENABLED = "";
process.env.PLATFORM_BALANCE_READINESS_LIVE_ENABLED = "";
process.env.GLOBAL_PAYOUTS_PROCEEDS_FUNDING_ENABLED = "";
process.env.LIVE_PAYMENTS_ENABLED = "";
assert.equal(isGlobalPayoutsProceedsFundingEnabled(), false);
assert.equal(isPlatformBankRemainderPayoutEnabled("TEST"), false);
assert.equal(isPlatformBankRemainderPayoutEnabled("LIVE"), false);
assert.equal(isPlatformBalanceReadinessEnabled("TEST"), false);
assert.equal(isPlatformBalanceReadinessEnabled("LIVE"), false);
process.env.PLATFORM_BALANCE_READINESS_TEST_ENABLED = "true";
assert.equal(isPlatformBalanceReadinessEnabled("TEST"), true);
assert.equal(isPlatformBalanceReadinessEnabled("LIVE"), false);
process.env.PLATFORM_BALANCE_READINESS_TEST_ENABLED = "";
process.env.PLATFORM_BALANCE_READINESS_LIVE_ENABLED = "true";
assert.equal(isPlatformBalanceReadinessEnabled("TEST"), false);
assert.equal(isPlatformBalanceReadinessEnabled("LIVE"), true);
process.env.PLATFORM_BALANCE_READINESS_LIVE_ENABLED = "";
process.env.PLATFORM_BANK_REMAINDER_PAYOUT_ENABLED = "true";
process.env.LIVE_PAYMENTS_ENABLED = "";
process.env.PLATFORM_BANK_REMAINDER_PAYOUT_LIVE_ENABLED = "";
assert.equal(isPlatformBankRemainderPayoutEnabled("TEST"), true);
assert.equal(isPlatformBankRemainderPayoutEnabled("LIVE"), false);
process.env.LIVE_PAYMENTS_ENABLED = "true";
assert.equal(isPlatformBankRemainderPayoutEnabled("LIVE"), false);
process.env.PLATFORM_BANK_REMAINDER_PAYOUT_LIVE_ENABLED = "true";
assert.equal(isPlatformBankRemainderPayoutEnabled("LIVE"), true);
process.env.GLOBAL_PAYOUTS_ENABLED = "true";
process.env.GLOBAL_PAYOUTS_PROCEEDS_FUNDING_ENABLED = "";
assert.equal(isGlobalPayoutsProceedsFundingEnabled(), false);

const historical = reservePurchase(
  gpPurchase({
    status: "RELEASED",
    outboundStatuses: ["SUCCEEDED"],
    chargeNetMinor: 3500,
    durablyCreditedMinor: 3500,
  }),
);
assert.equal(historical.gpMinor, 0);
assert.equal(
  completedPurchaseBlocksNewFunding({ txnStatus: "RELEASED", outboundStatuses: ["SUCCEEDED"] }),
  true,
);
assert.equal(
  fundingScanIncludesPurchase({
    txnStatus: "RELEASED",
    outboundStatuses: ["SUCCEEDED"],
    hasPendingFundingLeg: true,
  }),
  true,
);

const current = reservePurchase(gpPurchase());
assert.equal(current.gpMinor, 3878);
assert.equal(current.gpMinor > 3500 + 100, true);

const quotedHeadroom = reservePurchase(gpPurchase({ durablyCreditedMinor: 3600 }));
assert.equal(quotedHeadroom.gpMinor, 278);
const afterHigherQuote = plan({
  availableMinor: 10000,
  purchases: [gpPurchase({ durablyCreditedMinor: 3600, pendingFundingMinor: 0 })],
});
assert.equal(afterHigherQuote.amountMinor, 10000 - 278);
assert.equal(afterHigherQuote.code, "BANK_REMAINDER_PAY");

const finished = reservePurchase(
  gpPurchase({ status: "RELEASED", outboundStatuses: ["SUCCEEDED"], durablyCreditedMinor: 3600 }),
);
assert.equal(finished.gpMinor, 0);

const unknownNet = plan({ purchases: [gpPurchase({ chargeNetMinor: null })] });
assert.equal(unknownNet.amountMinor, 0);
assert.equal(unknownNet.code, "GP_RESERVE_UNKNOWN");

const mixed = plan({
  purchases: [
    gpPurchase(),
    connectPurchase(),
    connectPurchase({ paymentOption: "INSTANT", sellerEntitlementMinor: 9000, status: "RELEASED" }),
  ],
});
assert.equal(mixed.reservedMinor, 3878 + 5000);
assert.equal(mixed.amountMinor, 20000 - 3878 - 5000);

const liveDoesNotReduceTest = plan({
  purchases: [gpPurchase(), connectPurchase({ stripeMode: "LIVE", sellerEntitlementMinor: 999999 })],
});
assert.equal(liveDoesNotReduceTest.amountMinor, 20000 - 3878);

const pendingInsideReserve = plan({
  availableMinor: 10000,
  purchases: [gpPurchase({ pendingFundingMinor: 3600 }), connectPurchase({ pendingTransferMinor: 2000 })],
});
assert.equal(pendingInsideReserve.amountMinor, 0);
assert.equal(pendingInsideReserve.code, "UNRESOLVED_MOVEMENT");

const oneUnknownAmongMany = plan({
  purchases: [
    gpPurchase(),
    gpPurchase({ chargeNetMinor: 1000, sellerEntitlementMinor: 800, totalChargeMinor: 1100 }),
    gpPurchase({ chargeNetMinor: null, sellerEntitlementMinor: 100, totalChargeMinor: 200 }),
    connectPurchase(),
  ],
});
assert.equal(oneUnknownAmongMany.amountMinor, 0);
assert.equal(oneUnknownAmongMany.code, "GP_RESERVE_UNKNOWN");

const gbpWithoutTheUnknownUsd = plan({
  purchases: [gpPurchase(), connectPurchase()],
});
assert.equal(gbpWithoutTheUnknownUsd.amountMinor, 20000 - 3878 - 5000);
assert.equal(plan({ providerReadOk: false }).code, "PROVIDER_READ_FAILED");
assert.equal(plan({ unresolvedMovements: 1 }).amountMinor, 0);
assert.equal(plan({ unresolvedMovements: 1 }).code, "UNRESOLVED_MOVEMENT");

const disputed = plan({
  availableMinor: 10000,
  purchases: [
    connectPurchase({
      status: "DISPUTED",
      transferredMinor: 5000,
      sellerEntitlementMinor: 5000,
      openDispute: true,
      totalChargeMinor: 5350,
      refundedMinor: 0,
    }),
  ],
});
assert.equal(disputed.reservedMinor, 350);
assert.equal(disputed.amountMinor, 10000 - 350);

assert.equal(plan({ scheduleInterval: "daily" }).code, "GP_AUTOMATIC_BANK_PAYOUT");
assert.equal(plan({ scheduleInterval: "daily" }).amountMinor, 0);
assert.equal(plan({ scheduleInterval: null }).code, "GP_PAYOUT_SCHEDULE_UNREAD");
assert.equal(plan({ bankEnabled: false }).code, "BANK_REMAINDER_DISABLED");
assert.equal(plan({ uncertainBankAttempt: true }).code, "BANK_PAYOUT_UNCERTAIN");
assert.equal(plan({ destinationReady: false }).code, "BANK_DESTINATION_UNVERIFIED");
assert.equal(plan({ scanComplete: false }).code, "GP_RESERVE_UNKNOWN");
assert.equal(plan({ inflightBankMinor: 400, availableMinor: 1000 }).amountMinor, 600);

const bank = selectVerifiedPlatformBank(
  [
    {
      id: "ba_platform",
      object: "bank_account",
      currency: "gbp",
      defaultForCurrency: true,
      status: "verified",
      livemode: false,
    },
    {
      id: "ba_other",
      object: "bank_account",
      currency: "gbp",
      defaultForCurrency: false,
      status: "verified",
      livemode: false,
    },
    {
      id: "card_1",
      object: "card",
      currency: "gbp",
      defaultForCurrency: true,
      status: "verified",
      livemode: false,
    },
  ],
  { currency: "GBP", livemode: false, hasMore: false },
);
assert.equal(bank.ok && bank.destinationId, "ba_platform");
assert.equal(
  selectVerifiedPlatformBank(
    [
      {
        id: "ba_live",
        object: "bank_account",
        currency: "gbp",
        defaultForCurrency: true,
        status: "verified",
        livemode: true,
      },
    ],
    { currency: "gbp", livemode: false, hasMore: false },
  ).ok,
  false,
);

const now = Date.parse("2026-10-12T06:00:00.000Z");
assert.equal(lockAcquisition({ nowMs: now, lockedAtMs: null }), "acquire");
assert.equal(lockAcquisition({ nowMs: now, lockedAtMs: now - 1000 }), "busy");
assert.equal(
  lockAcquisition({ nowMs: now, lockedAtMs: now - PLATFORM_BALANCE_LOCK_STALE_MS }),
  "acquire",
);
assert.equal(
  platformBalanceHealth({ nowMs: now, enabled: true, lockedAtMs: now - 1000, lastSuccessAtMs: now }).stalled,
  false,
);
assert.equal(
  platformBalanceHealth({
    nowMs: now,
    enabled: true,
    lockedAtMs: now - PLATFORM_BALANCE_LOCK_STALE_MS,
    lastSuccessAtMs: now,
  }).code,
  "PLATFORM_BALANCE_STALE_LOCK",
);

assert.equal(
  decideFundingRequest({
    legExistedBeforeThisAttempt: true,
    ageMs: 1000,
    matchingPayoutIds: ["po_a", "po_a"],
  }).action,
  "attach",
);
assert.equal(
  decideFundingRequest({
    legExistedBeforeThisAttempt: true,
    ageMs: 1000,
    matchingPayoutIds: ["po_a", "po_b"],
  }).action,
  "uncertain",
);
assert.equal(
  decideFundingRequest({
    legExistedBeforeThisAttempt: true,
    ageMs: STRIPE_IDEMPOTENCY_WINDOW_MS - 1,
    matchingPayoutIds: [],
  }).action,
  "create_same_key",
);
assert.equal(
  decideFundingRequest({
    legExistedBeforeThisAttempt: true,
    ageMs: STRIPE_IDEMPOTENCY_WINDOW_MS,
    matchingPayoutIds: [],
  }).action,
  "uncertain",
);

const openBank = nextBankRemainderAttempt({
  mode: "TEST",
  currency: "GBP",
  attempts: [{ sequence: 1, status: "UNCERTAIN" }],
});
assert.equal(openBank.action, "reuse");
assert.equal(openBank.idempotencyKey, bankRemainderIdempotencyKey("TEST", "GBP", 1));
const secondBank = nextBankRemainderAttempt({
  mode: "TEST",
  currency: "GBP",
  attempts: [{ sequence: 1, status: "PAID" }],
});
assert.equal(secondBank.action, "create");
assert.equal(secondBank.sequence, 2);

const cutoverWhileDaily = manualScheduleCutoverDecision({
  bankRemainderEnabled: true,
  coordinationPresent: true,
  healthStalled: false,
  uncertainBankAttempts: 0,
  currencies: [{ currency: "GBP", destinationReady: true }],
});
assert.equal(cutoverWhileDaily.allowed, true);
assert.equal(plan({ scheduleInterval: "daily", availableMinor: 5000 }).amountMinor, 0);
assert.equal(
  manualScheduleCutoverDecision({
    bankRemainderEnabled: false,
    coordinationPresent: true,
    healthStalled: false,
    uncertainBankAttempts: 0,
    currencies: [{ currency: "GBP", destinationReady: true }],
  }).allowed,
  false,
);

assert.equal(
  dailyScheduleRollbackDecision({
    gpReservedMinor: 3878,
    connectReservedMinor: 0,
    refundReservedMinor: 0,
    inflightMinor: 0,
    uncertainAttempts: 0,
  }).allowed,
  false,
);
assert.equal(
  dailyScheduleRollbackDecision({
    gpReservedMinor: 0,
    connectReservedMinor: 0,
    refundReservedMinor: 0,
    inflightMinor: 0,
    uncertainAttempts: 0,
  }).code,
  "ROLLBACK_NO_PROTECTED_FUNDS",
);

let takeoverWrites = 0;
const stolen = await resumeWorkerAfterTakeover({
  held: { token: "worker-a", fence: 1 },
  readCurrent: () => ({ token: "worker-b", fence: 2 }),
  write: async () => {
    takeoverWrites += 1;
    return "stripe-write";
  },
});
assert.equal(stolen.submitted, false);
assert.equal(stolen.code, "LOCK_FENCE_LOST");
assert.equal(takeoverWrites, 0);
const ownerAfterTakeover = await resumeWorkerAfterTakeover({
  held: { token: "worker-b", fence: 2 },
  readCurrent: () => ({ token: "worker-b", fence: 2 }),
  write: async () => {
    takeoverWrites += 1;
    return "stripe-write";
  },
});
assert.equal(ownerAfterTakeover.submitted, true);
assert.equal(takeoverWrites, 1);

const readinessInput = {
  mode: "TEST",
  scheduleInterval: "daily",
  destinationReady: true,
  providerReadsOk: true,
  liabilitiesReadable: true,
  unresolvedMovements: 0,
  priorReadinessPass: false,
  moneyMovementEnabled: false,
};
const warmup = evaluateModeReadiness(readinessInput);
assert.equal(warmup.ready, false);
assert.equal(warmup.payoutsAllowed, false);
assert.equal(warmup.code, "CUTOVER_WARMUP");
const readyWhileDaily = evaluateModeReadiness({ ...readinessInput, priorReadinessPass: true });
assert.equal(readyWhileDaily.ready, true);
assert.equal(readyWhileDaily.payoutsAllowed, false);
assert.equal(readyWhileDaily.code, "READINESS_DAILY_SCHEDULE");
const paying = evaluateModeReadiness({
  ...readinessInput,
  priorReadinessPass: true,
  scheduleInterval: "manual",
  moneyMovementEnabled: true,
});
assert.equal(paying.ready, true);
assert.equal(paying.payoutsAllowed, true);
assert.equal(paying.code, "READINESS_READY");
const liveCold = evaluateModeReadiness({ ...readinessInput, mode: "LIVE" });
assert.equal(sharedScheduleCutover({ test: readyWhileDaily, live: liveCold }).allowed, false);
assert.equal(sharedScheduleCutover({ test: readyWhileDaily, live: liveCold }).code, "LIVE_NOT_READY");
assert.equal(
  readinessHeartbeatForMode([{ stripeMode: "TEST", readinessCheckedAt: "2026-10-12T00:00:00.000Z" }], "LIVE"),
  false,
);
assert.equal(
  readinessHeartbeatForMode([{ stripeMode: "LIVE", readinessCheckedAt: null }], "LIVE"),
  false,
);
assert.match(DASHBOARD_SCHEDULE_LIMIT, /Stripe Dashboard/);

const hidden = classifyStripeReadFailure({
  statusCode: 403,
  code: "more_permissions_required",
  type: "invalid_request_error",
  requestId: "req_safe123",
  message: "sk_test_secret ba_bankacct",
});
assert.equal(hidden.httpStatus, 403);
assert.equal(hidden.stripeCode, "more_permissions_required");
assert.equal(hidden.stripeType, "invalid_request_error");
assert.equal(hidden.requestId, "req_safe123");
assert.equal(JSON.stringify(hidden).includes("sk_test"), false);
assert.equal(JSON.stringify(hidden).includes("ba_"), false);
assert.equal(classifyStripeReadFailure({ requestId: "not-a-request" }).requestId, null);

const runner = read("src/lib/payments/payout-rail/platform-balance-run.ts");
const lock = read("src/lib/payments/payout-rail/platform-balance-lock.ts");
const cron = read("src/app/api/cron/payments-release/route.ts");
const fundingRunner = read("src/lib/payments/payout-rail/proceeds-funding-run.ts");
assert.match(lock, /FOR UPDATE/);
assert.match(runner, /reconcileOpenBankAttempts/);
assert.ok(runner.indexOf("reconcileOpenBankAttempts") < runner.indexOf("payouts.create"));
assert.match(runner, /decideFundingRequest/);
assert.match(runner, /CUTOVER_WARMUP/);
assert.match(runner, /hadPriorSuccess/);
assert.match(runner, /destination: destination\.destinationId/);
assert.ok(runner.indexOf("fencedProviderWrite") < runner.indexOf("payouts.create"));
assert.doesNotMatch(runner, /accounts\.update|payout_method|req\.body|searchParams/);
assert.doesNotMatch(runner, /interval:\s*["']manual["']/);
assert.match(fundingRunner, /lockHeld/);
assert.ok(fundingRunner.indexOf("fencedProviderWrite") < fundingRunner.indexOf("payouts.create"));
assert.match(fundingRunner, /completedPurchaseBlocksNewFunding|GP_COMPLETED_OUTBOUND_STATUSES/);
const readiness = read("src/lib/payments/payout-rail/platform-balance-readiness.ts");
assert.match(readiness, /accounts\.listExternalAccounts/);
assert.match(readiness, /classifyStripeReadFailure|providerRead/);
assert.doesNotMatch(readiness, /catch \{\s*providerReadsOk = false;\s*\}/);
assert.match(readiness, /recordObservedGpNet/);
assert.doesNotMatch(readiness, /payouts\.create|prepareQuoteOnly|transfers\.create|refunds\.create|accounts\.update/);
const readinessRoute = read("src/app/api/admin/platform-balance-readiness/route.ts");
assert.match(readinessRoute, /runReadOnlyPlatformReadiness\("TEST"\)/);
assert.doesNotMatch(readinessRoute, /processInspectionReleases|coordinatePlatformBalance|runReadOnlyPlatformReadiness\("LIVE"\)/);
assert.match(cron, /reconcileGpProceedsFunding\(\{ stripeMode: "TEST" \}\)/);
assert.match(cron, /coordinatePlatformBalance\(\{ stripeMode: "TEST" \}\)/);
assert.doesNotMatch(cron, /reconcileGpProceedsFunding\(\{ stripeMode: "LIVE" \}\)/);
assert.match(cron, /isPlatformBalanceReadinessEnabled\("TEST"\)/);
assert.match(cron, /isPlatformBalanceReadinessEnabled\("LIVE"\)/);
assert.match(cron, /runReadOnlyPlatformReadiness\("TEST"\)/);
assert.match(cron, /runReadOnlyPlatformReadiness\("LIVE"\)/);
const liveMoneyCall = cron.indexOf('coordinatePlatformBalance({ stripeMode: "LIVE" })');
assert.ok(liveMoneyCall > cron.indexOf("liveMoney"));
assert.match(read("src/lib/payments/release.ts"), /isCoordinationRetryable\(err\)\) throw err/);
assert.match(read("src/lib/payments/admin-protected-decision.ts"), /refunds\.create/);
assert.match(read("src/lib/payments/flags.ts"), /PLATFORM_BANK_REMAINDER_PAYOUT_ENABLED", false/);
assert.match(read("src/lib/payments/flags.ts"), /PLATFORM_BANK_REMAINDER_PAYOUT_LIVE_ENABLED", false/);
assert.match(read("src/lib/payments/stripe/webhooks.ts"), /sb_bank_remainder/);
assert.doesNotMatch(read("prisma/migrations/20261012130000_platform_balance_coordination/migration.sql"), /DROP TABLE/);

console.log("platform balance tests passed");
