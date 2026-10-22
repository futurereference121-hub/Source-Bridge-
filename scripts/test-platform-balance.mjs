/**
 * Platform balance coordination. No Stripe network and no payout.
 * Run: node scripts/test-platform-balance.mjs
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
const settlementAmount = await import(pathToFileURL(path.join(root, "src/lib/payments/payout-rail/connect-settlement-amount.ts")).href);
const funding = await import(pathToFileURL(path.join(root, "src/lib/payments/payout-rail/proceeds-funding.ts")).href);
const flags = await import(pathToFileURL(path.join(root, "src/lib/payments/flags.ts")).href);

const {
  PLATFORM_BALANCE_LOCK_STALE_MS,
  STRIPE_IDEMPOTENCY_WINDOW_MS,
  bankRemainderIdempotencyKey,
  classifyStripeReadFailure,
  DASHBOARD_SCHEDULE_LIMIT,
  PLATFORM_PAYOUT_SCHEDULE_ISOLATION,
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
  testOnlyManualScheduleDecision,
  dualModeManualScheduleActivation,
  bankCurrencies,
  connectReleaseSettlementMinor,
  listedBalanceAmounts,
  listedBalanceCurrencies,
  outstandingConnectReserves,
  connectReserveForCurrency,
  settlementBlockForCurrency,
  settlementLiabilityCurrencies,
  assessTestPlatformAccount,
  assessLivePlatformAccount,
  dashboardConfirmationApplies,
  dashboardBankConfirmationMatches,
  DASHBOARD_BANK_CONFIRMATION_EVIDENCE,
  DASHBOARD_BANK_CONFIRMATION_ACCOUNT_SUFFIX,
  DASHBOARD_BANK_CONFIRMATION_LIVE_ACCOUNT_SUFFIX,
  DASHBOARD_BANK_CONFIRMATION_LIVE_ACCOUNT_HASH8,
} = balance;
const { applyOutstandingChargeSettlement, connectSettlementTransferMinor, shapeOutstandingChargeSettlement } = settlementAmount;
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
assert.equal(
  plan({ destinationReady: false, bankInformation: "unavailable", providerReadOk: true }).code,
  "BANK_INFORMATION_UNAVAILABLE",
);
assert.equal(
  plan({ destinationReady: false, bankInformation: "unavailable", providerReadOk: true }).amountMinor,
  0,
);
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
const normalExternal = selectVerifiedPlatformBank(
  [
    {
      id: "ba_platform_new",
      object: "bank_account",
      currency: "gbp",
      defaultForCurrency: true,
      status: "new",
      livemode: null,
    },
  ],
  { currency: "gbp", livemode: false, hasMore: false },
);
assert.equal(normalExternal.ok && normalExternal.destinationId, "ba_platform_new");
assert.equal(
  selectVerifiedPlatformBank(
    [
      {
        id: "ba_errored",
        object: "bank_account",
        currency: "gbp",
        defaultForCurrency: true,
        status: "errored",
        livemode: null,
      },
    ],
    { currency: "gbp", livemode: false, hasMore: false },
  ).ok,
  false,
);
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
const embedded = balance.readPlatformExternalAccounts({
  external_accounts: {
    has_more: false,
    data: [
      {
        id: "ba_embedded",
        object: "bank_account",
        currency: "gbp",
        default_for_currency: true,
        status: "new",
        last4: "6789",
        routing_number: "110000000",
      },
    ],
  },
});
assert.equal(embedded.ok, true);
assert.equal(embedded.ok && embedded.accounts[0].defaultForCurrency, true);
assert.equal(JSON.stringify(embedded).includes("6789"), false);
assert.equal(JSON.stringify(embedded).includes("110000000"), false);
assert.equal(balance.readPlatformExternalAccounts({}).ok, false);
const absentBank = balance.assessPlatformBank(balance.readPlatformExternalAccounts({}), {
  currency: "gbp",
  livemode: false,
});
assert.equal(absentBank.defaultDestinationRouting, "supported");
assert.equal(absentBank.bankConfigurationVerified, false);
assert.equal(absentBank.bankInformation, "unavailable");
assert.equal(absentBank.code, "BANK_INFORMATION_UNAVAILABLE");
const confirmedBank = balance.assessPlatformBank(embedded, { currency: "gbp", livemode: false });
assert.equal(confirmedBank.bankConfigurationVerified, true);
assert.equal(confirmedBank.bankInformation, "verified");
assert.equal(confirmedBank.defaultDestinationRouting, "supported");

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
const bankUnavailable = evaluateModeReadiness({
  ...readinessInput,
  destinationReady: false,
  bankInformation: "unavailable",
  priorReadinessPass: true,
  moneyMovementEnabled: true,
  scheduleInterval: "manual",
});
assert.equal(bankUnavailable.ready, false);
assert.equal(bankUnavailable.payoutsAllowed, false);
assert.equal(bankUnavailable.code, "BANK_INFORMATION_UNAVAILABLE");
const gbpDashboard = evaluateModeReadiness({
  ...readinessInput,
  currency: "GBP",
  destinationReady: false,
  bankInformation: "unavailable",
  dashboardConfirmation: "recorded",
});
assert.equal(gbpDashboard.ready, false);
assert.equal(gbpDashboard.payoutsAllowed, false);
assert.equal(gbpDashboard.code, "CUTOVER_WARMUP");
const gbpAfterWarmup = evaluateModeReadiness({
  ...readinessInput,
  currency: "GBP",
  destinationReady: false,
  bankInformation: "unavailable",
  dashboardConfirmation: "recorded",
  priorReadinessPass: true,
  scheduleInterval: "daily",
  moneyMovementEnabled: true,
});
assert.equal(gbpAfterWarmup.ready, true);
assert.equal(gbpAfterWarmup.payoutsAllowed, false);
assert.equal(gbpAfterWarmup.code, "READINESS_DAILY_SCHEDULE");
const usdStillBlocked = evaluateModeReadiness({
  ...readinessInput,
  currency: "USD",
  destinationReady: false,
  bankInformation: "unavailable",
  dashboardConfirmation: "recorded",
  priorReadinessPass: true,
});
assert.equal(usdStillBlocked.ready, false);
assert.equal(usdStillBlocked.code, "BANK_INFORMATION_UNAVAILABLE");
const confirmedProviderFailure = evaluateModeReadiness({
  ...readinessInput,
  currency: "GBP",
  providerReadsOk: false,
  bankInformation: "unavailable",
  dashboardConfirmation: "recorded",
  priorReadinessPass: true,
});
assert.equal(confirmedProviderFailure.code, "PROVIDER_READ_FAILED");
const confirmedMovement = evaluateModeReadiness({
  ...readinessInput,
  currency: "GBP",
  unresolvedMovements: 1,
  bankInformation: "unavailable",
  dashboardConfirmation: "recorded",
  priorReadinessPass: true,
});
assert.equal(confirmedMovement.code, "UNRESOLVED_MOVEMENT");
const confirmedApiBank = evaluateModeReadiness({
  ...readinessInput,
  currency: "GBP",
  destinationReady: false,
  bankInformation: "unverified",
  dashboardConfirmation: "recorded",
  priorReadinessPass: true,
});
assert.equal(confirmedApiBank.code, "BANK_DESTINATION_UNVERIFIED");
const settlementBeatsConfirmation = evaluateModeReadiness({
  ...readinessInput,
  currency: "GBP",
  destinationReady: false,
  bankInformation: "unavailable",
  dashboardConfirmation: "recorded",
  priorReadinessPass: true,
  settlementCode: "SETTLEMENT_RESERVE_UNRESOLVED",
});
assert.equal(settlementBeatsConfirmation.ready, false);
assert.equal(settlementBeatsConfirmation.payoutsAllowed, false);
assert.equal(settlementBeatsConfirmation.code, "SETTLEMENT_RESERVE_UNRESOLVED");
assert.deepEqual(bankCurrencies({ balanceCurrencies: ["gbp", "gbp"] }), ["GBP"]);
assert.equal(bankCurrencies({ balanceCurrencies: ["gbp"] }).includes("USD"), false);
const openSeller = connectPurchase({
  currency: "USD",
  sellerEntitlementMinor: 2500,
  totalChargeMinor: 2550,
  protectionFeeMinor: 50,
});
const unknownSettlement = plan({
  availableMinor: 100000,
  purchases: [openSeller, connectPurchase({
    currency: "USD",
    status: "FUNDED",
    sellerEntitlementMinor: 6500,
    totalChargeMinor: 6630,
    protectionFeeMinor: 130,
  }), connectPurchase({
    currency: "USD",
    status: "DELIVERED",
    sellerEntitlementMinor: 5000,
    totalChargeMinor: 5100,
    protectionFeeMinor: 100,
  })],
});
assert.equal(openSeller.sellerEntitlementMinor, 2500);
assert.equal(unknownSettlement.amountMinor, 0);
assert.equal(unknownSettlement.code, "SETTLEMENT_CURRENCY_UNKNOWN");
assert.equal(unknownSettlement.reservedMinor, 0);
const missingGross = plan({
  purchases: [connectPurchase({
    currency: "USD",
    sellerEntitlementMinor: 2500,
    settlementCurrency: "GBP",
    chargeAmountMinor: null,
    balanceTransactionAmountMinor: null,
  })],
});
assert.equal(missingGross.amountMinor, 0);
assert.equal(missingGross.code, "SETTLEMENT_RESERVE_UNRESOLVED");
const seller2500 = connectReleaseSettlementMinor({
  presentmentMinor: 2500,
  chargeAmountMinor: 2550,
  balanceTransactionAmountMinor: 2000,
});
const seller6500 = connectReleaseSettlementMinor({
  presentmentMinor: 6500,
  chargeAmountMinor: 6630,
  balanceTransactionAmountMinor: 5200,
});
const seller5000 = connectReleaseSettlementMinor({
  presentmentMinor: 5000,
  chargeAmountMinor: 5100,
  balanceTransactionAmountMinor: 4000,
});
assert.equal(seller2500, 1960);
assert.equal(seller6500, 5098);
assert.equal(seller5000, 3921);
assert.notEqual(seller2500, Math.round(2500 * 0.79));
const chargeGross = 2550;
const settledGross = 2014;
const presentment = 2500;
const releaseDebit = Math.max(1, Math.floor((presentment * settledGross) / chargeGross));
assert.equal(connectSettlementTransferMinor(presentment, chargeGross, settledGross), releaseDebit);
assert.equal(connectReleaseSettlementMinor({
  presentmentMinor: presentment,
  chargeAmountMinor: chargeGross,
  balanceTransactionAmountMinor: settledGross,
}), releaseDebit);
const procurementDebit = connectSettlementTransferMinor(1000, chargeGross, settledGross);
const finalDebit = connectSettlementTransferMinor(1500, chargeGross, settledGross);
assert.ok(releaseDebit >= procurementDebit + finalDebit);
const readFacts = shapeOutstandingChargeSettlement({
  mode: "TEST",
  purchaseCurrency: "USD",
  requestedChargeId: "ch_fixture",
  platformOwned: true,
  charge: {
    id: "ch_fixture",
    livemode: false,
    currency: "usd",
    amount: chargeGross,
    balanceTransaction: {
      currency: "gbp",
      amount: settledGross,
      net: 1900,
      exchange_rate: 0.79,
    },
  },
});
assert.equal(readFacts.ok, true);
assert.equal(readFacts.ok && readFacts.balanceTransactionNetMinor, 1900);
const readPurchase = applyOutstandingChargeSettlement(connectPurchase({
  currency: "USD",
  sellerEntitlementMinor: presentment,
  totalChargeMinor: chargeGross,
  protectionFeeMinor: 50,
}), readFacts);
assert.equal(readPurchase.sellerEntitlementMinor, presentment);
const readPlan = plan({ availableMinor: 20000, purchases: [readPurchase] });
assert.equal(readPlan.reservedMinor, releaseDebit);
assert.equal(readPlan.amountMinor, 20000 - releaseDebit);
assert.notEqual(readPlan.reservedMinor, 1900);
assert.notEqual(readPlan.reservedMinor, Math.round(presentment * 0.79));
const held = plan({
  availableMinor: 3878,
  purchases: [gpPurchase({ chargeNetMinor: 3878 }), readPurchase],
});
assert.equal(held.amountMinor, 0);
assert.ok(held.reservedMinor > 3878);
assert.equal(held.code, "BANK_REMAINDER_NONE");
const failedRead = shapeOutstandingChargeSettlement({
  mode: "TEST",
  purchaseCurrency: "USD",
  requestedChargeId: "ch_fixture",
  platformOwned: true,
  failure: { stripeCode: "rate_limit" },
});
const failedPlan = plan({
  availableMinor: 100000,
  purchases: [applyOutstandingChargeSettlement(connectPurchase({
    currency: "USD",
    sellerEntitlementMinor: presentment,
  }), failedRead)],
});
assert.equal(failedPlan.amountMinor, 0);
assert.equal(failedPlan.code, "SETTLEMENT_READ_FAILED");
assert.equal(shapeOutstandingChargeSettlement({
  mode: "TEST",
  purchaseCurrency: "USD",
  requestedChargeId: "ch_fixture",
  platformOwned: false,
  charge: { id: "ch_fixture", livemode: false, currency: "usd", amount: chargeGross, balanceTransaction: { currency: "gbp", amount: settledGross, net: 1900 } },
}).code, "SETTLEMENT_OWNERSHIP_UNVERIFIED");
assert.equal(shapeOutstandingChargeSettlement({
  mode: "TEST",
  purchaseCurrency: "USD",
  requestedChargeId: "ch_fixture",
  platformOwned: true,
  charge: { id: "ch_other", livemode: false, currency: "usd", amount: chargeGross, balanceTransaction: { currency: "gbp", amount: settledGross, net: 1900 } },
}).code, "SETTLEMENT_OWNERSHIP_UNVERIFIED");
assert.equal(shapeOutstandingChargeSettlement({
  mode: "TEST",
  purchaseCurrency: "USD",
  requestedChargeId: "ch_fixture",
  platformOwned: true,
  charge: { id: "ch_fixture", livemode: true, currency: "usd", amount: chargeGross, balanceTransaction: { currency: "gbp", amount: settledGross, net: 1900 } },
}).code, "SETTLEMENT_MODE_MISMATCH");
assert.equal(shapeOutstandingChargeSettlement({
  mode: "TEST",
  purchaseCurrency: "USD",
  requestedChargeId: "ch_fixture",
  platformOwned: true,
  charge: { id: "ch_fixture", livemode: false, currency: "usd", amount: chargeGross, balanceTransaction: { livemode: true, currency: "gbp", amount: settledGross, net: 1900 } },
}).code, "SETTLEMENT_MODE_MISMATCH");
assert.equal(shapeOutstandingChargeSettlement({
  mode: "TEST",
  purchaseCurrency: "USD",
  requestedChargeId: "ch_fixture",
  platformOwned: true,
  charge: { id: "ch_fixture", livemode: false, currency: "usd", amount: chargeGross, balanceTransaction: { currency: "gbp", amount: settledGross } },
}).code, "SETTLEMENT_RESERVE_UNRESOLVED");
assert.deepEqual(listedBalanceCurrencies([{ currency: "gbp", amount: 0 }]), ["gbp"]);
assert.deepEqual(bankCurrencies({
  balanceCurrencies: [],
  settlementCurrencies: settlementLiabilityCurrencies([readPurchase], "TEST"),
}), ["GBP"]);
assert.equal(bankCurrencies({
  balanceCurrencies: listedBalanceCurrencies([{ currency: "usd", amount: 0 }]),
  settlementCurrencies: settlementLiabilityCurrencies([readPurchase], "TEST"),
}).includes("GBP"), true);
const priced = plan({
  availableMinor: 20000,
  purchases: [
    connectPurchase({
      currency: "USD",
      sellerEntitlementMinor: 2500,
      totalChargeMinor: 2550,
      protectionFeeMinor: 50,
      settlementCurrency: "GBP",
      chargeAmountMinor: 2550,
      balanceTransactionAmountMinor: 2000,
    }),
    connectPurchase({
      currency: "USD",
      sellerEntitlementMinor: 6500,
      totalChargeMinor: 6630,
      protectionFeeMinor: 130,
      settlementCurrency: "GBP",
      chargeAmountMinor: 6630,
      balanceTransactionAmountMinor: 5200,
    }),
    connectPurchase({
      currency: "USD",
      status: "DELIVERED",
      sellerEntitlementMinor: 5000,
      totalChargeMinor: 5100,
      protectionFeeMinor: 100,
      settlementCurrency: "GBP",
      chargeAmountMinor: 5100,
      balanceTransactionAmountMinor: 4000,
    }),
  ],
});
assert.equal(priced.reservedMinor, 1960 + 5098 + 3921);
assert.equal(priced.amountMinor, 20000 - priced.reservedMinor);
assert.equal(priced.code, "BANK_REMAINDER_PAY");
assert.notEqual(priced.reservedMinor, 2500 + 6500 + 5000);
const releasedUsd = plan({
  purchases: [connectPurchase({
    currency: "USD",
    status: "RELEASED",
    sellerEntitlementMinor: 30000,
    transferredMinor: 30000,
  })],
});
assert.equal(releasedUsd.code, "BANK_REMAINDER_PAY");
assert.equal(releasedUsd.reservedMinor, 0);
const refundedUsd = plan({
  purchases: [connectPurchase({
    currency: "USD",
    status: "REFUNDED",
    sellerEntitlementMinor: 4000,
    refundedMinor: 4140,
    totalChargeMinor: 4140,
  })],
});
assert.equal(refundedUsd.code, "BANK_REMAINDER_PAY");
const disputedUsd = plan({
  purchases: [connectPurchase({
    currency: "USD",
    status: "DISPUTED",
    openDispute: true,
    settlementCurrency: "GBP",
    chargeAmountMinor: 2550,
    balanceTransactionAmountMinor: 2000,
  })],
});
assert.equal(disputedUsd.amountMinor, 0);
assert.equal(disputedUsd.code, "SETTLEMENT_RESERVE_UNRESOLVED");
const pendingNet = plan({
  availableMinor: 0,
  purchases: [gpPurchase({ chargeNetMinor: 3878 })],
});
assert.equal(pendingNet.amountMinor, 0);
assert.equal(pendingNet.reservedMinor, 3878);
assert.equal(pendingNet.code, "BANK_REMAINDER_NONE");
const unrelated = plan({
  availableMinor: 3878,
  purchases: [gpPurchase({ chargeNetMinor: 3878 }), openSeller],
});
assert.equal(unrelated.amountMinor, 0);
assert.equal(unrelated.code, "SETTLEMENT_CURRENCY_UNKNOWN");
assert.equal(settlementBlockForCurrency([openSeller], "GBP", "TEST"), "SETTLEMENT_CURRENCY_UNKNOWN");
const confirmedDoesNotClearReserve = plan({
  destinationReady: false,
  bankInformation: "unavailable",
  dashboardConfirmation: "recorded",
  purchases: [openSeller],
});
assert.equal(confirmedDoesNotClearReserve.amountMinor, 0);
assert.equal(confirmedDoesNotClearReserve.code, "SETTLEMENT_CURRENCY_UNKNOWN");
const usdRecordedPlan = plan({
  currency: "USD",
  destinationReady: false,
  bankInformation: "unavailable",
  dashboardConfirmation: "recorded",
});
assert.equal(usdRecordedPlan.amountMinor, 0);
assert.equal(usdRecordedPlan.code, "BANK_INFORMATION_UNAVAILABLE");
const gbpDailyConfirmed = plan({
  scheduleInterval: "daily",
  destinationReady: false,
  bankInformation: "unavailable",
  dashboardConfirmation: "recorded",
});
assert.equal(gbpDailyConfirmed.amountMinor, 0);
assert.equal(gbpDailyConfirmed.code, "GP_AUTOMATIC_BANK_PAYOUT");
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
assert.equal(PLATFORM_PAYOUT_SCHEDULE_ISOLATION, "SHARED_TEST_MODE_SANDBOX");
assert.equal(
  sharedScheduleCutover({ test: { ready: true }, live: { ready: true } }).code,
  "SHARED_CUTOVER_READY",
);
assert.equal(
  testOnlyManualScheduleDecision(PLATFORM_PAYOUT_SCHEDULE_ISOLATION).allowed,
  false,
);
assert.equal(
  testOnlyManualScheduleDecision(PLATFORM_PAYOUT_SCHEDULE_ISOLATION).code,
  "SHARED_SCHEDULE_WITH_LIVE",
);
assert.equal(
  dualModeManualScheduleActivation({
    isolation: PLATFORM_PAYOUT_SCHEDULE_ISOLATION,
    testReady: true,
    liveReady: false,
    liveBankRemainderEnabled: false,
    liveBankRemainderHealthy: false,
  }).code,
  "LIVE_NOT_READY",
);
assert.equal(
  dualModeManualScheduleActivation({
    isolation: PLATFORM_PAYOUT_SCHEDULE_ISOLATION,
    testReady: true,
    liveReady: true,
    liveBankRemainderEnabled: false,
    liveBankRemainderHealthy: false,
  }).code,
  "LIVE_BANK_REMAINDER_DISABLED",
);
assert.equal(
  dualModeManualScheduleActivation({
    isolation: PLATFORM_PAYOUT_SCHEDULE_ISOLATION,
    testReady: true,
    liveReady: true,
    liveBankRemainderEnabled: true,
    liveBankRemainderHealthy: true,
  }).code,
  "SHARED_MANUAL_CUTOVER_READY",
);
assert.equal(testOnlyManualScheduleDecision("ISOLATED_SANDBOX").allowed, true);
const liveIgnoresTestConnect = plan({
  mode: "LIVE",
  scheduleInterval: "manual",
  availableMinor: 10000,
  purchases: [connectPurchase({ stripeMode: "TEST", sellerEntitlementMinor: 8000 })],
});
assert.equal(liveIgnoresTestConnect.code, "BANK_REMAINDER_PAY");
assert.equal(liveIgnoresTestConnect.amountMinor, 10000);
const liveHoldsLiveConnect = plan({
  mode: "LIVE",
  scheduleInterval: "manual",
  availableMinor: 10000,
  purchases: [connectPurchase({ stripeMode: "LIVE", sellerEntitlementMinor: 3500 })],
});
assert.equal(liveHoldsLiveConnect.amountMinor, 6500);
assert.equal(liveHoldsLiveConnect.reservedMinor, 3500);
const dailyBlocksLiveRemainder = plan({
  mode: "LIVE",
  scheduleInterval: "daily",
  availableMinor: 10000,
  purchases: [],
});
assert.equal(dailyBlocksLiveRemainder.amountMinor, 0);
assert.equal(dailyBlocksLiveRemainder.code, "GP_AUTOMATIC_BANK_PAYOUT");
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
const payoutCreate = runner.slice(runner.indexOf("payouts.create"), runner.indexOf("payouts.create") + 450);
assert.doesNotMatch(payoutCreate, /destination:/);
assert.match(payoutCreate, /sb_bank_remainder: attempt\.id/);
assert.match(runner, /sb_bank_remainder === attempt\.id/);
assert.match(runner, /payout\.livemode === \(mode === "LIVE"\)/);
assert.match(runner, /payout\.livemode !== \(opts\.mode === "LIVE"\)/);
assert.match(runner, /BANK_PAYOUT_MODE_MISMATCH/);
assert.doesNotMatch(runner, /destination ===/);
assert.ok(runner.indexOf("fencedProviderWrite") < runner.indexOf("payouts.create"));
assert.doesNotMatch(runner, /accounts\.update|payout_method|req\.body|searchParams|listExternalAccounts/);
assert.doesNotMatch(runner, /interval:\s*["']manual["']/);
assert.match(fundingRunner, /lockHeld/);
assert.ok(fundingRunner.indexOf("fencedProviderWrite") < fundingRunner.indexOf("payouts.create"));
assert.match(fundingRunner, /completedPurchaseBlocksNewFunding|GP_COMPLETED_OUTBOUND_STATUSES/);
const readiness = read("src/lib/payments/payout-rail/platform-balance-readiness.ts");
assert.match(readiness, /assessPlatformBank/);
assert.match(readiness, /Charge nets are independent of bank verification/);
assert.doesNotMatch(readiness, /platform_external_accounts_absent/);
assert.doesNotMatch(readiness, /listExternalAccounts/);
assert.match(readiness, /classifyStripeReadFailure|providerRead/);
assert.doesNotMatch(readiness, /catch \{\s*providerReadsOk = false;\s*\}/);
assert.match(readiness, /recordObservedGpNet/);
assert.match(readiness, /stored\?\.balanceTransactionId && \(stored\.chargeNetMinor \?\? 0\) > 0/);
assert.match(readiness, /balance\.pending/);
const currenciesFn = readiness.slice(
  readiness.indexOf("async function currenciesForRead"),
  readiness.indexOf("type ProviderRead"),
);
assert.doesNotMatch(currenciesFn, /protectedTransaction/);
assert.match(runner, /balance\.pending/);
const discoverFn = runner.slice(runner.indexOf("async function discoverCurrencies"), runner.indexOf("export async function coordinatePlatformBalance"));
assert.doesNotMatch(discoverFn, /protectedTransaction/);
const settlementFn = fundingRunner.slice(
  fundingRunner.indexOf("function settlementFromCharge"),
  fundingRunner.indexOf("async function platformRoom"),
);
assert.match(settlementFn, /livemode: charge\.livemode/);
assert.doesNotMatch(settlementFn, /livemode\?:/);
assert.match(fundingRunner, /connectReserveForCurrency/);
assert.match(fundingRunner, /loadPlatformLiabilities/);
assert.match(fundingRunner, /connectReserveCode/);
assert.doesNotMatch(readiness, /payouts\.create|prepareQuoteOnly|transfers\.create|refunds\.create|accounts\.update/);
const readinessRoute = read("src/app/api/admin/platform-balance-readiness/route.ts");
assert.match(readinessRoute, /runReadOnlyPlatformReadiness\("TEST"\)/);
assert.match(readinessRoute, /balance: report\.balance/);
assert.match(readinessRoute, /outstandingConnect: report\.outstandingConnect/);
assert.doesNotMatch(readinessRoute, /processInspectionReleases|coordinatePlatformBalance|runReadOnlyPlatformReadiness\("LIVE"\)/);
assert.match(readinessRoute, /payoutScheduleIsolation: PLATFORM_PAYOUT_SCHEDULE_ISOLATION/);
assert.doesNotMatch(fundingRunner, /interval:\s*["']manual["']/);
assert.doesNotMatch(fundingRunner, /accounts\.update/);
assert.match(readiness, /outstandingConnectReserves/);
assert.match(readiness, /listedBalanceAmounts/);
assert.match(readiness, /available: balance\.available/);
assert.match(readiness, /pending: balance\.pending/);
assert.match(cron, /reconcileGpProceedsFunding\(\{ stripeMode: "TEST" \}\)/);
assert.match(cron, /coordinatePlatformBalance\(\{ stripeMode: "TEST" \}\)/);
assert.match(cron, /coordinatePlatformBalance\(\{ stripeMode: "LIVE" \}\)/);
assert.doesNotMatch(cron, /reconcileGpProceedsFunding\(\{ stripeMode: "LIVE" \}\)/);
assert.doesNotMatch(cron, /testMoney|liveMoney/);
assert.match(cron, /isPlatformBalanceReadinessEnabled\("TEST"\)/);
assert.match(cron, /isPlatformBalanceReadinessEnabled\("LIVE"\)/);
assert.match(cron, /runReadOnlyPlatformReadiness\("TEST"\)/);
assert.match(cron, /runReadOnlyPlatformReadiness\("LIVE"\)/);
assert.match(cron, /maxDuration = 120/);
const liveCoord = cron.indexOf('coordinatePlatformBalance({ stripeMode: "LIVE" })');
const testCoord = cron.indexOf('coordinatePlatformBalance({ stripeMode: "TEST" })');
assert.ok(testCoord >= 0 && liveCoord > testCoord);
const liveReadinessRoute = read("src/app/api/admin/platform-balance-readiness-live/route.ts");
assert.match(liveReadinessRoute, /runReadOnlyPlatformReadiness\("LIVE"\)/);
assert.match(liveReadinessRoute, /payoutsAllowed: false/);
assert.doesNotMatch(liveReadinessRoute, /runReadOnlyPlatformReadiness\("TEST"\)|payouts\.create|accounts\.update/);
const monitorRoute = read("src/app/api/admin/platform-balance-monitor/route.ts");
assert.match(monitorRoute, /platformBalanceMonitor\("TEST"\)/);
assert.match(monitorRoute, /platformBalanceMonitor\("LIVE"\)/);
assert.match(monitorRoute, /payoutsAllowed: false/);
assert.doesNotMatch(monitorRoute, /payouts\.create|accounts\.update/);
assert.match(read("src/lib/payments/release.ts"), /isCoordinationRetryable\(err\)\) throw err/);
assert.match(read("src/lib/payments/admin-protected-decision.ts"), /refunds\.create/);
assert.match(read("src/lib/payments/flags.ts"), /PLATFORM_BANK_REMAINDER_PAYOUT_ENABLED", false/);
assert.match(read("src/lib/payments/flags.ts"), /PLATFORM_BANK_REMAINDER_PAYOUT_LIVE_ENABLED", false/);
assert.match(read("src/lib/payments/stripe/webhooks.ts"), /sb_bank_remainder/);
const releaseSource = read("src/lib/payments/release.ts");
assert.equal(releaseSource.split("connectSettlementTransferMinor").length - 1, 3);
assert.doesNotMatch(releaseSource, /Math\.floor\(\(amount \* bt\.amount\)/);
const chargeReader = read("src/lib/payments/payout-rail/outstanding-charge-settlement.ts");
assert.match(chargeReader, /expand: \["balance_transaction"\]/);
assert.doesNotMatch(chargeReader, /stripeAccount|prisma|payouts\.create|charges\.update/);
const liabilityLoad = runner.slice(runner.indexOf("export async function loadPlatformLiabilities"), runner.indexOf("async function listMatchingBankPayouts"));
assert.match(liabilityLoad, /retrieveOutstandingChargeSettlement/);
assert.doesNotMatch(liabilityLoad, /protectedTransaction\.update|gpProceedsFunding\.upsert/);
assert.doesNotMatch(read("prisma/migrations/20261012130000_platform_balance_coordination/migration.sql"), /DROP TABLE/);
assert.doesNotMatch(read("prisma/migrations/20261014140000_platform_bank_dashboard_confirmation/migration.sql"), /DROP TABLE/);
const confirmationRoute = read("src/app/api/admin/platform-bank-dashboard-confirmation/route.ts");
assert.match(confirmationRoute, /requireAdmin/);
assert.match(confirmationRoute, /getStripe\("TEST"\)/);
assert.match(confirmationRoute, /getStripe\("LIVE"\)/);
assert.match(confirmationRoute, /isPlatformBalanceReadinessEnabled\(stripeMode\)/);
assert.match(confirmationRoute, /currency === "USD"/);
assert.match(confirmationRoute, /bankConfigurationVerified: false/);
assert.match(confirmationRoute, /assessTestPlatformAccount/);
assert.match(confirmationRoute, /assessLivePlatformAccount/);
assert.match(confirmationRoute, /balance\.retrieve/);
assert.match(confirmationRoute, /balance\.livemode/);
assert.doesNotMatch(confirmationRoute, /body\.accountId|body\.accountHash|body\.suffix|body\.accountSuffix/);
assert.doesNotMatch(confirmationRoute, /retrievedAccountLivemode\(account\) !== false/);
assert.doesNotMatch(confirmationRoute, /payouts\.create|accounts\.update|ready:\s*true/);
const confirmationModule = read("src/lib/payments/payout-rail/platform-bank-confirmation.ts");
assert.match(confirmationModule, /modeEvidenceLivemode/);
assert.match(confirmationModule, /Account\.livemode is not a reliable TEST contract/);
assert.match(confirmationModule, /An omitted field is not LIVE/);
const noLivemodeOk = assessTestPlatformAccount({
  stripeMode: "TEST",
  accountId: "acct_test_platform_MV9g",
  accountLivemode: null,
  modeEvidenceLivemode: false,
});
assert.equal(noLivemodeOk.ok, true);
assert.equal(noLivemodeOk.ok && noLivemodeOk.suffix, "MV9g");
assert.match(noLivemodeOk.ok ? noLivemodeOk.hash8 : "", /^[a-f0-9]{8}$/);
assert.equal(assessTestPlatformAccount({
  stripeMode: "TEST",
  accountId: "acct_test_platform_MV9g",
  accountLivemode: false,
  modeEvidenceLivemode: false,
}).ok, true);
assert.equal(assessTestPlatformAccount({
  stripeMode: "TEST",
  accountId: "acct_wrong_XXXX",
  accountLivemode: null,
  modeEvidenceLivemode: false,
}).code, "ACCOUNT_IDENTITY_MISMATCH");
assert.equal(assessTestPlatformAccount({
  stripeMode: "TEST",
  accountId: "acct_test_platform_MV9g",
  accountLivemode: true,
  modeEvidenceLivemode: false,
}).code, "LIVE_ACCOUNT_OBJECT");
assert.equal(assessTestPlatformAccount({
  stripeMode: "TEST",
  accountId: "acct_test_platform_MV9g",
  accountLivemode: null,
  modeEvidenceLivemode: true,
}).code, "TEST_MODE_EVIDENCE_MISSING");
assert.equal(assessTestPlatformAccount({
  stripeMode: "TEST",
  accountId: "acct_test_platform_MV9g",
  accountLivemode: null,
  modeEvidenceLivemode: null,
}).code, "TEST_MODE_EVIDENCE_MISSING");
assert.equal(assessTestPlatformAccount({
  stripeMode: "LIVE",
  accountId: "acct_test_platform_MV9g",
  accountLivemode: null,
  modeEvidenceLivemode: false,
}).code, "TEST_MODE_REQUIRED");
assert.equal(assessTestPlatformAccount({
  stripeMode: "TEST",
  accountId: "",
  accountLivemode: null,
  modeEvidenceLivemode: false,
}).code, "ACCOUNT_ID_MISSING");
const liveFixtureId = "acct_live_platform_SOps";
const liveFixtureHash = createHash("sha256").update(liveFixtureId).digest("hex").slice(0, 8);
assert.equal(DASHBOARD_BANK_CONFIRMATION_LIVE_ACCOUNT_SUFFIX, "SOps");
assert.equal(DASHBOARD_BANK_CONFIRMATION_LIVE_ACCOUNT_HASH8, "3a9b400a");
const liveOk = assessLivePlatformAccount({
  stripeMode: "LIVE",
  accountId: liveFixtureId,
  accountLivemode: true,
  modeEvidenceLivemode: true,
  expectedHash8: liveFixtureHash,
});
assert.equal(liveOk.ok, true);
assert.equal(liveOk.ok && liveOk.suffix, "SOps");
assert.equal(liveOk.ok && liveOk.hash8, liveFixtureHash);
assert.equal(assessLivePlatformAccount({
  stripeMode: "LIVE",
  accountId: liveFixtureId,
  accountLivemode: null,
  modeEvidenceLivemode: true,
  expectedHash8: liveFixtureHash,
}).ok, true);
assert.equal(assessLivePlatformAccount({
  stripeMode: "TEST",
  accountId: liveFixtureId,
  accountLivemode: true,
  modeEvidenceLivemode: true,
  expectedHash8: liveFixtureHash,
}).code, "LIVE_MODE_REQUIRED");
assert.equal(assessLivePlatformAccount({
  stripeMode: "LIVE",
  accountId: liveFixtureId,
  accountLivemode: true,
  modeEvidenceLivemode: false,
  expectedHash8: liveFixtureHash,
}).code, "LIVE_MODE_EVIDENCE_MISSING");
assert.equal(assessLivePlatformAccount({
  stripeMode: "LIVE",
  accountId: liveFixtureId,
  accountLivemode: true,
  modeEvidenceLivemode: null,
  expectedHash8: liveFixtureHash,
}).code, "LIVE_MODE_EVIDENCE_MISSING");
assert.equal(assessLivePlatformAccount({
  stripeMode: "LIVE",
  accountId: liveFixtureId,
  accountLivemode: false,
  modeEvidenceLivemode: true,
  expectedHash8: liveFixtureHash,
}).code, "TEST_ACCOUNT_OBJECT");
assert.equal(assessLivePlatformAccount({
  stripeMode: "LIVE",
  accountId: "acct_wrong_XXXX",
  accountLivemode: true,
  modeEvidenceLivemode: true,
}).code, "ACCOUNT_IDENTITY_MISMATCH");
assert.equal(assessLivePlatformAccount({
  stripeMode: "LIVE",
  accountId: liveFixtureId,
  accountLivemode: true,
  modeEvidenceLivemode: true,
}).code, "ACCOUNT_IDENTITY_MISMATCH");
assert.equal(assessLivePlatformAccount({
  stripeMode: "LIVE",
  accountId: "",
  accountLivemode: true,
  modeEvidenceLivemode: true,
}).code, "ACCOUNT_ID_MISSING");
assert.equal(
  dashboardConfirmationApplies({ mode: "TEST", currency: "GBP", dashboardConfirmation: "recorded" }),
  true,
);
assert.equal(
  dashboardConfirmationApplies({ mode: "LIVE", currency: "GBP", dashboardConfirmation: "recorded" }),
  true,
);
assert.equal(
  dashboardConfirmationApplies({ mode: "LIVE", currency: "USD", dashboardConfirmation: "recorded" }),
  false,
);
assert.equal(
  dashboardConfirmationApplies({ mode: "LIVE", currency: "GBP", dashboardConfirmation: "absent" }),
  false,
);
assert.equal(
  dashboardBankConfirmationMatches({
    stripeMode: "TEST",
    currency: "GBP",
    accountSuffix: DASHBOARD_BANK_CONFIRMATION_ACCOUNT_SUFFIX,
    livemode: false,
    evidence: DASHBOARD_BANK_CONFIRMATION_EVIDENCE,
    recordedAccountHash: "aaaaaaaa",
    currentAccountHash: "aaaaaaaa",
  }),
  true,
);
assert.equal(
  dashboardBankConfirmationMatches({
    stripeMode: "LIVE",
    currency: "GBP",
    accountSuffix: DASHBOARD_BANK_CONFIRMATION_LIVE_ACCOUNT_SUFFIX,
    livemode: true,
    evidence: DASHBOARD_BANK_CONFIRMATION_EVIDENCE,
    recordedAccountHash: DASHBOARD_BANK_CONFIRMATION_LIVE_ACCOUNT_HASH8,
    currentAccountHash: DASHBOARD_BANK_CONFIRMATION_LIVE_ACCOUNT_HASH8,
  }),
  true,
);
assert.equal(
  dashboardBankConfirmationMatches({
    stripeMode: "LIVE",
    currency: "GBP",
    accountSuffix: DASHBOARD_BANK_CONFIRMATION_LIVE_ACCOUNT_SUFFIX,
    livemode: false,
    evidence: DASHBOARD_BANK_CONFIRMATION_EVIDENCE,
    recordedAccountHash: DASHBOARD_BANK_CONFIRMATION_LIVE_ACCOUNT_HASH8,
    currentAccountHash: DASHBOARD_BANK_CONFIRMATION_LIVE_ACCOUNT_HASH8,
  }),
  false,
);
assert.equal(
  dashboardBankConfirmationMatches({
    stripeMode: "TEST",
    currency: "GBP",
    accountSuffix: DASHBOARD_BANK_CONFIRMATION_LIVE_ACCOUNT_SUFFIX,
    livemode: true,
    evidence: DASHBOARD_BANK_CONFIRMATION_EVIDENCE,
    recordedAccountHash: DASHBOARD_BANK_CONFIRMATION_LIVE_ACCOUNT_HASH8,
    currentAccountHash: DASHBOARD_BANK_CONFIRMATION_LIVE_ACCOUNT_HASH8,
  }),
  false,
);
assert.equal(
  dashboardBankConfirmationMatches({
    stripeMode: "LIVE",
    currency: "GBP",
    accountSuffix: DASHBOARD_BANK_CONFIRMATION_ACCOUNT_SUFFIX,
    livemode: true,
    evidence: DASHBOARD_BANK_CONFIRMATION_EVIDENCE,
    recordedAccountHash: DASHBOARD_BANK_CONFIRMATION_LIVE_ACCOUNT_HASH8,
    currentAccountHash: DASHBOARD_BANK_CONFIRMATION_LIVE_ACCOUNT_HASH8,
  }),
  false,
);
assert.equal(
  dashboardBankConfirmationMatches({
    stripeMode: "LIVE",
    currency: "USD",
    accountSuffix: DASHBOARD_BANK_CONFIRMATION_LIVE_ACCOUNT_SUFFIX,
    livemode: true,
    evidence: DASHBOARD_BANK_CONFIRMATION_EVIDENCE,
    recordedAccountHash: DASHBOARD_BANK_CONFIRMATION_LIVE_ACCOUNT_HASH8,
    currentAccountHash: DASHBOARD_BANK_CONFIRMATION_LIVE_ACCOUNT_HASH8,
  }),
  false,
);
const liveGbpDashboard = evaluateModeReadiness({
  ...readinessInput,
  mode: "LIVE",
  currency: "GBP",
  destinationReady: false,
  bankInformation: "unavailable",
  dashboardConfirmation: "recorded",
  priorReadinessPass: true,
  scheduleInterval: "daily",
  moneyMovementEnabled: true,
});
assert.equal(liveGbpDashboard.ready, true);
assert.equal(liveGbpDashboard.payoutsAllowed, false);
assert.equal(liveGbpDashboard.code, "READINESS_DAILY_SCHEDULE");
const liveUsdStillBlocked = evaluateModeReadiness({
  ...readinessInput,
  mode: "LIVE",
  currency: "USD",
  destinationReady: false,
  bankInformation: "unavailable",
  dashboardConfirmation: "recorded",
  priorReadinessPass: true,
});
assert.equal(liveUsdStillBlocked.code, "BANK_INFORMATION_UNAVAILABLE");
const liveConfirmedProviderFailure = evaluateModeReadiness({
  ...readinessInput,
  mode: "LIVE",
  currency: "GBP",
  providerReadsOk: false,
  bankInformation: "unavailable",
  dashboardConfirmation: "recorded",
  priorReadinessPass: true,
});
assert.equal(liveConfirmedProviderFailure.code, "PROVIDER_READ_FAILED");
const liveConfirmedApiBank = evaluateModeReadiness({
  ...readinessInput,
  mode: "LIVE",
  currency: "GBP",
  destinationReady: false,
  bankInformation: "unverified",
  dashboardConfirmation: "recorded",
  priorReadinessPass: true,
});
assert.equal(liveConfirmedApiBank.code, "BANK_DESTINATION_UNVERIFIED");
const liveSettlementBeatsConfirmation = evaluateModeReadiness({
  ...readinessInput,
  mode: "LIVE",
  currency: "GBP",
  destinationReady: false,
  bankInformation: "unavailable",
  dashboardConfirmation: "recorded",
  priorReadinessPass: true,
  settlementCode: "SETTLEMENT_RESERVE_UNRESOLVED",
});
assert.equal(liveSettlementBeatsConfirmation.code, "SETTLEMENT_RESERVE_UNRESOLVED");
const liveNegativeKeepsReserve = plan({
  mode: "LIVE",
  currency: "GBP",
  scheduleInterval: "manual",
  availableMinor: -21100,
  destinationReady: false,
  bankInformation: "unavailable",
  dashboardConfirmation: "recorded",
  purchases: [connectPurchase({ stripeMode: "LIVE", currency: "GBP", sellerEntitlementMinor: 3600 })],
});
assert.equal(liveNegativeKeepsReserve.amountMinor, 0);
assert.notEqual(liveNegativeKeepsReserve.code, "BANK_REMAINDER_PAY");
const liveConfirmedNoPayWhileDaily = plan({
  mode: "LIVE",
  currency: "GBP",
  scheduleInterval: "daily",
  availableMinor: 10000,
  destinationReady: false,
  bankInformation: "unavailable",
  dashboardConfirmation: "recorded",
  purchases: [connectPurchase({ stripeMode: "LIVE", currency: "GBP", sellerEntitlementMinor: 3600 })],
});
assert.equal(liveConfirmedNoPayWhileDaily.amountMinor, 0);
assert.equal(liveConfirmedNoPayWhileDaily.code, "GP_AUTOMATIC_BANK_PAYOUT");
assert.match(readiness, /modeEvidenceLivemode/);
assert.match(readiness, /Account identity does not depend on Account\.livemode/);
assert.doesNotMatch(readiness, /accountId && accountLivemode !== null/);
const confirmPage = read("src/app/admin/platform-balance/page.tsx");
const confirmButton = read("src/app/admin/platform-balance/confirm-gbp-bank-button.tsx");
const liveConfirmButton = read("src/app/admin/platform-balance/confirm-live-gbp-bank-button.tsx");
assert.match(confirmPage, /ConfirmGbpBankButton/);
assert.match(confirmPage, /ConfirmLiveGbpBankButton/);
assert.match(confirmPage, /Opening this page does not record/);
assert.doesNotMatch(confirmPage, /fetch\(|platform-bank-dashboard-confirmation/);
assert.match(confirmButton, /Record TEST GBP Dashboard confirmation/);
assert.match(confirmButton, /\/api\/admin\/platform-bank-dashboard-confirmation/);
assert.match(confirmButton, /currency: "GBP"/);
assert.doesNotMatch(confirmButton, /stripeMode: "LIVE"|payouts\.create|quotesCreated|ready:\s*true|accounts\.update/);
assert.match(liveConfirmButton, /Record LIVE GBP Dashboard confirmation/);
assert.match(liveConfirmButton, /stripeMode: "LIVE"/);
assert.match(liveConfirmButton, /currency: "GBP"/);
assert.doesNotMatch(liveConfirmButton, /accountId|payouts\.create|quotesCreated|ready:\s*true|accounts\.update/);
assert.match(confirmationModule, /assessLivePlatformAccount/);
assert.match(confirmationModule, /stripeMode: mode/);
assert.doesNotMatch(confirmationModule, /stripeMode: "TEST",\s*currency: "GBP"/);
assert.match(read("src/app/admin/_components/AdminNav.tsx"), /\/admin\/platform-balance/);
const reserveRows = outstandingConnectReserves([
  {
    ...connectPurchase({
      currency: "USD",
      sellerEntitlementMinor: 2500,
      totalChargeMinor: 2550,
      protectionFeeMinor: 50,
      settlementCurrency: "GBP",
      chargeAmountMinor: 2550,
      balanceTransactionAmountMinor: 2014,
      purchaseHash: "abcd1234",
    }),
  },
], "TEST");
assert.equal(reserveRows.length, 1);
assert.equal(reserveRows[0].purchaseHash, "abcd1234");
assert.equal(reserveRows[0].settlementCurrency, "GBP");
assert.equal(reserveRows[0].reserveMinor, connectSettlementTransferMinor(2500, 2550, 2014));
assert.equal(reserveRows[0].readOk, true);
assert.equal(reserveRows[0].readCode, null);
const gbpConnectHold = connectReserveForCurrency([
  {
    ...connectPurchase({
      currency: "USD",
      sellerEntitlementMinor: 2500,
      totalChargeMinor: 2550,
      protectionFeeMinor: 50,
      settlementCurrency: "GBP",
      chargeAmountMinor: 2550,
      balanceTransactionAmountMinor: 2014,
      purchaseHash: "abcd1234",
    }),
  },
], "TEST", "GBP");
assert.equal(gbpConnectHold.code, null);
assert.equal(gbpConnectHold.reservedMinor, connectSettlementTransferMinor(2500, 2550, 2014));
const gbpIgnoresUsdBank = connectReserveForCurrency([
  {
    ...connectPurchase({
      currency: "USD",
      sellerEntitlementMinor: 2500,
      totalChargeMinor: 2550,
      protectionFeeMinor: 50,
      settlementCurrency: "GBP",
      chargeAmountMinor: 2550,
      balanceTransactionAmountMinor: 2014,
      purchaseHash: "abcd1234",
    }),
  },
], "TEST", "USD");
assert.equal(gbpIgnoresUsdBank.code, null);
assert.equal(gbpIgnoresUsdBank.reservedMinor, 0);
assert.deepEqual(listedBalanceAmounts([{ currency: "gbp", amount: 0 }, { currency: "gbp", amount: 3878 }]), [
  { currency: "GBP", amountMinor: 0 },
  { currency: "GBP", amountMinor: 3878 },
]);

console.log("platform balance tests passed");
