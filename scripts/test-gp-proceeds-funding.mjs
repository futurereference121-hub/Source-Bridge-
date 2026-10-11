/**
 * Offline Global Payouts proceeds funding.
 * Uses the stored £40.25 TEST purchase shape. No Stripe network and no cash injection.
 *
 * Run: node scripts/test-gp-proceeds-funding.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

if (process.env.SB_GP_PROCEEDS_TEST !== "1") {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/SECRET|TOKEN|KEY|DATABASE|POSTGRES|NEON|STRIPE|PASSWORD|COOKIE|AUTH/i.test(key)) {
      delete env[key];
    }
  }
  env.SB_GP_PROCEEDS_TEST = "1";
  env.NODE_ENV = "test";
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", fileURLToPath(import.meta.url)],
    { cwd: root, env, stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}

const funding = await import(
  pathToFileURL(path.join(root, "src/lib/payments/payout-rail/proceeds-funding.ts")).href
);

const quoteConfirmation = await import(
  pathToFileURL(path.join(root, "src/lib/payments/payout-rail/quote-confirmation.ts")).href
);

const {
  GP_FUNDING_HOLD_COPY,
  GP_FUNDING_PROCESSING_COPY,
  GP_FUNDING_PROGRESS_COPY,
  GP_PROCEEDS_FUNDING_MECHANISM,
  GP_RELEASE_WAITING_COPY,
  STRIPE_IDEMPOTENCY_WINDOW_MS,
  allocateGpProceedsFunding,
  assessChargeSettlement,
  automaticBankPayoutBlocksFunding,
  classifyStoredQuote,
  completedPurchaseBlocksNewFunding,
  decideFundingRequest,
  describeGpBuyerPayout,
  fundingScanIncludesPurchase,
  fundingIdempotencyKey,
  fundingPayoutMatchesLeg,
  isSimulatedFundingCredit,
  matchFundingCredit,
  nextFundingLegSequence,
  planProceedsAfterQuote,
} = funding;
const { gpQuoteConfirmationRequired } = quoteConfirmation;

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const PURCHASE = {
  grossMinor: 4025,
  principalMinor: 3500,
  protectionFeeMinor: 525,
  currency: "GBP",
};
const now = new Date("2026-10-14T12:00:00.000Z");
const fundedAt = new Date("2026-10-10T07:02:22.486Z");

function charge(overrides = {}) {
  return assessChargeSettlement(
    {
      chargeId: "ch_test_4025",
      livemode: false,
      currency: "gbp",
      grossMinor: PURCHASE.grossMinor,
      refundedMinor: 0,
      netMinor: 3900,
      balanceStatus: "available",
      availableOn: new Date("2026-10-13T00:00:00.000Z"),
      ...overrides,
    },
    "TEST",
  );
}

function input(overrides = {}) {
  return {
    payoutRail: "STRIPE_GLOBAL_PAYOUTS",
    stripeMode: "TEST",
    initiationAllowed: true,
    currency: PURCHASE.currency,
    principalMinor: PURCHASE.principalMinor,
    payoutFeeMinor: 0,
    charge: charge(),
    postedMinor: 0,
    pendingMinor: 0,
    platformAvailableMinor: 3900,
    reservedMinor: 0,
    otherInFlightMinor: 0,
    txnStatus: "FUNDED",
    openDispute: false,
    now,
    ...overrides,
  };
}

assert.equal(GP_PROCEEDS_FUNDING_MECHANISM, "v1_payout_to_financial_account");
assert.equal(PURCHASE.grossMinor, 2000 + 500 + 1000 + PURCHASE.protectionFeeMinor);
assert.equal(PURCHASE.principalMinor, 3500);

const client = read("src/lib/payments/payout-rail/gp-client.ts");
assert.match(client, /STRIPE_GP_API_VERSION = "2026-08-26\.preview"/);
const runner = read("src/lib/payments/payout-rail/proceeds-funding-run.ts");
assert.match(runner, /payout_method: opts.financialAccountId/);
assert.match(runner, /apiVersion: STRIPE_GP_API_VERSION/);
assert.match(runner, /prepareQuoteOnly/);
assert.match(runner, /decideFundingRequest/);
assert.match(runner, /automaticBankPayoutBlocksFunding/);
assert.match(runner, /isGlobalPayoutsProceedsFundingEnabled/);
assert.doesNotMatch(runner, /payout_schedule|interval_anchor/);
assert.match(runner, /BUYER_RELEASE_NOW/);
assert.match(runner, /FOR UPDATE/);
assert.match(runner, /GP_FUNDING_ALREADY_COMPLETED/);
assert.match(runner, /newFundingAllowedNow/);
assert.match(runner, /GP_COMPLETED_OUTBOUND_STATUSES/);
const fundBody = runner.slice(runner.indexOf("async function fundOne"), runner.indexOf("async function confirmLegs"));
assert.ok(fundBody.indexOf("pendingLegs.length") < fundBody.indexOf("GP_FUNDING_ALREADY_COMPLETED"));
assert.ok(fundBody.indexOf("GP_FUNDING_ALREADY_COMPLETED") < fundBody.indexOf("prepareFundingQuote"));
let sendCursor = 0;
while (sendCursor >= 0) {
  const sendAt = fundBody.indexOf("sendFundingPayout", sendCursor);
  if (sendAt < 0) break;
  const prior = fundBody.lastIndexOf("newFundingAllowedNow", sendAt);
  assert.ok(prior >= 0 && sendAt - prior < 500);
  sendCursor = sendAt + 1;
}
assert.match(runner, /posted < principal \+ fees/);

const historical = {
  purchaseHash: "50bf732e",
  txnStatus: "RELEASED",
  outboundStatuses: ["SUCCEEDED"],
  hasPendingFundingLeg: false,
};
assert.equal(historical.purchaseHash, "50bf732e");
assert.equal(fundingScanIncludesPurchase(historical), false);
assert.equal(completedPurchaseBlocksNewFunding(historical), true);
assert.equal(
  fundingScanIncludesPurchase({ ...historical, hasPendingFundingLeg: true }),
  true,
);
assert.equal(completedPurchaseBlocksNewFunding({ ...historical, outboundStatuses: ["RECONCILED"] }), true);
assert.equal(3500 + 245, 3745);
const currentPurchase = {
  purchaseHash: "597151ee",
  txnStatus: "READY_TO_RELEASE",
  outboundStatuses: ["AWAITING_FA_FUNDS"],
  hasPendingFundingLeg: false,
};
assert.equal(currentPurchase.purchaseHash, "597151ee");
assert.equal(fundingScanIncludesPurchase(currentPurchase), true);
assert.equal(completedPurchaseBlocksNewFunding(currentPurchase), false);
assert.equal(3500 + 525, 4025);
assert.match(runner, /isSimulatedFundingCredit|matchFundingCredit/);
assert.doesNotMatch(read("src/lib/payments/payout-rail/outbound-payment.ts"), /awaiting Financial Account funds/);

const webhook = read("src/lib/payments/stripe/webhooks.ts");
const balanceCase = webhook.slice(
  webhook.indexOf('case "balance.available"'),
  webhook.indexOf('case "payout.paid"'),
);
assert.match(balanceCase, /onPlatformBalanceAvailable\(verifiedMode\)/);
assert.doesNotMatch(balanceCase, /event\.data/);
assert.match(webhook, /metadata\?\.sb_funding_leg|sb_funding_leg/);

const cron = read("src/app/api/cron/payments-release/route.ts");
assert.match(cron, /reconcileGpProceedsFunding\(\{ stripeMode: "TEST" \}\)/);
assert.match(cron, /isGlobalPayoutsProceedsFundingEnabled\(\)/);
assert.doesNotMatch(cron, /reconcileGpProceedsFunding\(\{ stripeMode: "LIVE" \}\)/);
assert.match(read("src/lib/payments/flags.ts"), /GLOBAL_PAYOUTS_PROCEEDS_FUNDING_ENABLED", false/);
const migration = read("prisma/migrations/20261010170000_gp_proceeds_funding/migration.sql");
assert.match(migration, /CREATE TABLE "GpProceedsFunding"/);
assert.match(migration, /"quoteIdempotencyKey" TEXT NOT NULL DEFAULT ''/);
assert.match(migration, /GpProceedsFundingLeg_idempotencyKey_key/);
assert.doesNotMatch(migration, /DROP TABLE/);
assert.match(read("src/lib/payments/stripe/webhooks.ts"), /"balance.available"/);
assert.match(read("src/lib/payments/stripe/webhooks.ts"), /"payout.paid"/);
assert.match(read("vercel.json"), /"path": "\/api\/cron\/payments-release"[\s\S]*"schedule": "\*\/10 \* \* \* \*"/);
assert.match(read("src/lib/payments/admin-protected-decision.ts"), /REFUND_BLOCKED_GP_FUNDING/);
assert.match(read("src/lib/payments/payout-rail/quote-confirmation.ts"), /!== "TEST"/);

const card = read("src/components/messaging/PaymentTicketCard.tsx");
assert.match(card, /gpPayoutProgress\?\.hideReleaseActions/);
assert.match(card, /GP_FUNDING_HOLD_COPY/);
assert.doesNotMatch(card, /continues automatically/);
assert.match(card, /releaseHold/);
const purchases = read("src/app/profile/purchases/page.tsx");
assert.match(purchases, /gpPayoutProgress\?\.hideReleaseActions/);
assert.match(purchases, /GP_FUNDING_HOLD_COPY/);
assert.doesNotMatch(purchases, /continues automatically/);

const started = process.hrtime.bigint();
const first = allocateGpProceedsFunding(input());
const decisionMs = Number(process.hrtime.bigint() - started) / 1e6;
assert.equal(first.action, "fund");
assert.equal(first.amountMinor, PURCHASE.principalMinor);
assert.ok(first.amountMinor < PURCHASE.grossMinor);
assert.ok(decisionMs < 50, `decision took ${decisionMs}ms`);
console.log(`trigger_to_decision_ms ${decisionMs.toFixed(3)}`);

const delayed = allocateGpProceedsFunding(
  input({
    charge: charge({
      balanceStatus: "pending",
      availableOn: new Date("2026-10-20T00:00:00.000Z"),
    }),
  }),
);
assert.equal(delayed.action, "wait");
assert.equal(delayed.status, "AWAITING_SETTLEMENT");

const duplicate = allocateGpProceedsFunding(input({ pendingMinor: PURCHASE.principalMinor }));
assert.equal(duplicate.action, "wait");
assert.equal(duplicate.code, "GP_FUNDING_IN_FLIGHT");

const txnId = "txn_4025";
const restart = nextFundingLegSequence(txnId, [
  { sequence: 1, amountMinor: 3500, status: "PENDING", stripePayoutId: "po_existing", faCreditId: "" },
]);
assert.equal(restart.action, "wait");
assert.equal(restart.idempotencyKey, fundingIdempotencyKey(txnId, 1));
const crashed = nextFundingLegSequence(txnId, [
  { sequence: 1, amountMinor: 3500, status: "PENDING", stripePayoutId: "", faCreditId: "" },
]);
assert.equal(crashed.action, "reuse");
assert.equal(crashed.idempotencyKey, fundingIdempotencyKey(txnId, 1));
const failedLeg = nextFundingLegSequence(txnId, [
  { sequence: 1, amountMinor: 3500, status: "FAILED", stripePayoutId: "po_failed", faCreditId: "" },
]);
assert.equal(failedLeg.action, "create");
assert.equal(failedLeg.sequence, 2);
assert.notEqual(failedLeg.idempotencyKey, fundingIdempotencyKey(txnId, 1));
const uncertainLeg = nextFundingLegSequence(txnId, [
  {
    sequence: 1,
    amountMinor: 3500,
    status: "FAILED",
    stripePayoutId: "",
    faCreditId: "",
    failureCode: "GP_FUNDING_OUTCOME_UNCERTAIN",
  },
]);
assert.equal(uncertainLeg.action, "reuse");
assert.equal(uncertainLeg.idempotencyKey, fundingIdempotencyKey(txnId, 1));

const withFees = allocateGpProceedsFunding(
  input({ payoutFeeMinor: 200, postedMinor: 3500, platformAvailableMinor: 400 }),
);
assert.equal(withFees.action, "fund");
assert.equal(withFees.amountMinor, 200);

const overNet = allocateGpProceedsFunding(
  input({ payoutFeeMinor: 500, postedMinor: 3500, platformAvailableMinor: 5000 }),
);
assert.equal(overNet.action, "wait");
assert.equal(overNet.status, "SHORT");

const other = allocateGpProceedsFunding(
  input({
    principalMinor: 3500,
    platformAvailableMinor: 7000,
    otherInFlightMinor: 3500,
    charge: charge({ chargeId: "ch_other", netMinor: 3900 }),
  }),
);
assert.equal(other.action, "fund");
assert.equal(other.amountMinor, 3500);
const crowded = allocateGpProceedsFunding(
  input({
    platformAvailableMinor: 3900,
    otherInFlightMinor: 3500,
    charge: charge({ chargeId: "ch_second", netMinor: 3900 }),
  }),
);
assert.equal(crowded.action, "wait");
assert.equal(crowded.code, "GP_FUNDING_ROOM");

assert.equal(
  allocateGpProceedsFunding(input({ initiationAllowed: false, stripeMode: "LIVE", charge: assessChargeSettlement({
    chargeId: "ch_live",
    livemode: true,
    currency: "gbp",
    grossMinor: 4025,
    refundedMinor: 0,
    netMinor: 3900,
    balanceStatus: "available",
    availableOn: now,
  }, "LIVE") })).action,
  "blocked",
);
assert.equal(allocateGpProceedsFunding(input({ payoutRail: "STRIPE_CONNECT" })).code, "GP_FUNDING_NOT_GP");
assert.equal(allocateGpProceedsFunding(input({ openDispute: true })).code, "GP_FUNDING_NOT_ELIGIBLE");
assert.equal(
  allocateGpProceedsFunding(input({ charge: charge({ refundedMinor: 4025 }) })).code,
  "GP_CHARGE_REFUNDED",
);

const complete = allocateGpProceedsFunding(input({ payoutFeeMinor: 200, postedMinor: 3700 }));
assert.equal(complete.action, "complete");

function receivedCredit(overrides = {}) {
  return {
    id: "rc_real",
    type: "balance_transfer",
    status: "succeeded",
    livemode: false,
    financial_account: "fa_test",
    amount: { value: 3500, currency: "gbp" },
    balance_transfer: { type: "payout_v1", payout_v1: "po_1" },
    ...overrides,
  };
}
function matchCredit(overrides = {}) {
  return matchFundingCredit({
    payoutId: "po_1",
    financialAccountId: "fa_test",
    amountMinor: 3500,
    currency: "GBP",
    payoutStatus: "paid",
    livemode: false,
    credits: [receivedCredit()],
    claimedCreditIds: [],
    ...overrides,
  });
}
const simulated = receivedCredit({ id: "rc_sim", source: "received_credit_test_helper" });
assert.equal(isSimulatedFundingCredit(simulated), true);
assert.equal(matchCredit({ credits: [simulated] }), null);
assert.equal(matchCredit().creditId, "rc_real");
assert.equal(
  matchCredit({
    credits: [receivedCredit({ id: "rc_a" }), receivedCredit({ id: "rc_b" })],
  }),
  null,
);
assert.equal(
  matchCredit({
    credits: [
      receivedCredit({
        id: "rc_unrelated",
        description: "po_1",
        balance_transfer: { payout_v1: "po_other" },
      }),
    ],
  }),
  null,
);
assert.equal(
  matchCredit({
    credits: [
      {
        id: "rc_bank",
        type: "bank_transfer",
        status: "succeeded",
        livemode: false,
        financial_account: "fa_test",
        amount: { value: 3500, currency: "gbp" },
        description: "po_1 leg_1",
      },
    ],
  }),
  null,
);
assert.equal(matchCredit({ payoutStatus: "pending" }), null);

assert.equal(
  describeGpBuyerPayout({
    releaseAuthorized: false,
    txnStatus: "DELIVERED",
    now,
    fundedAt,
  }),
  null,
);
const waiting = describeGpBuyerPayout({
  releaseAuthorized: true,
  txnStatus: "READY_TO_RELEASE",
  outboundStatus: "AWAITING_FA_FUNDS",
  failureCode: "GP_FA_BALANCE_SHORT",
  fundingStatus: "AWAITING_SETTLEMENT",
  chargeAvailable: false,
  availableOn: new Date("2026-10-15T00:00:00.000Z"),
  fundedAt,
  proceedsFundingEnabled: true,
  now,
});
assert.equal(waiting.phase, "waiting_settlement");
assert.equal(waiting.headline, GP_RELEASE_WAITING_COPY);
assert.equal(waiting.hideReleaseActions, true);
const fundingOff = describeGpBuyerPayout({
  releaseAuthorized: true,
  txnStatus: "READY_TO_RELEASE",
  outboundStatus: "AWAITING_FA_FUNDS",
  failureCode: "GP_FA_BALANCE_SHORT",
  chargeAvailable: true,
  proceedsFundingEnabled: false,
  now,
});
assert.equal(fundingOff.phase, "review");
assert.equal(fundingOff.headline, GP_FUNDING_HOLD_COPY);
assert.equal(fundingOff.hideReleaseActions, true);
assert.doesNotMatch(fundingOff.headline, /automatically/);
assert.doesNotMatch(fundingOff.headline, /Financial Account|payout schedule|manual/);
const scheduleHold = describeGpBuyerPayout({
  releaseAuthorized: true,
  txnStatus: "READY_TO_RELEASE",
  outboundStatus: "AWAITING_FA_FUNDS",
  chargeAvailable: false,
  proceedsFundingEnabled: true,
  configurationBlocked: true,
  now,
});
assert.equal(scheduleHold.headline, GP_FUNDING_HOLD_COPY);
assert.equal(scheduleHold.hideReleaseActions, true);
assert.doesNotMatch(scheduleHold.headline, /automatically/);
assert.match(waiting.timing, /15 October 2026/);
assert.match(waiting.timing, /three business days from payment/);
assert.match(waiting.timing, /taking longer than the usual three business days/);
assert.doesNotMatch(waiting.timing, /within three days of release/);

const sending = describeGpBuyerPayout({
  releaseAuthorized: true,
  txnStatus: "READY_TO_RELEASE",
  outboundStatus: "PROCESSING",
  outboundIdPresent: true,
  expectedArrival: new Date("2026-10-20T00:00:00.000Z"),
  now,
});
assert.equal(sending.phase, "sending");
assert.match(sending.timing, /20 October 2026/);
assert.match(sending.timing, /not a promise that the sourcer is paid within three days of release/);
const sendingUnknown = describeGpBuyerPayout({
  releaseAuthorized: true,
  txnStatus: "READY_TO_RELEASE",
  outboundStatus: "PROCESSING",
  outboundIdPresent: true,
  now,
});
assert.match(sendingUnknown.timing, /has not given a bank arrival date/);
assert.match(sendingUnknown.timing, /not promised within three days of release/);

const sent = describeGpBuyerPayout({
  releaseAuthorized: true,
  txnStatus: "RELEASED",
  outboundStatus: "SUCCEEDED",
  now,
});
assert.equal(sent.phase, "sent");
assert.match(sent.headline, /does not confirm the sourcer/);
const failed = describeGpBuyerPayout({
  releaseAuthorized: true,
  txnStatus: "READY_TO_RELEASE",
  outboundStatus: "FAILED",
  failureCode: "GP_PAYOUT_FAILED",
  now,
});
assert.equal(failed.phase, "failed");
assert.equal(failed.hideReleaseActions, true);
const returned = describeGpBuyerPayout({
  releaseAuthorized: true,
  txnStatus: "READY_TO_RELEASE",
  outboundStatus: "RETURNED",
  now,
});
assert.equal(returned.phase, "returned");
assert.equal(returned.hideReleaseActions, true);

assert.equal(gpQuoteConfirmationRequired("TEST", "STRIPE_GLOBAL_PAYOUTS"), false);
assert.equal(gpQuoteConfirmationRequired("LIVE", "STRIPE_GLOBAL_PAYOUTS"), true);
const quoteNow = now.getTime();
assert.equal(
  classifyStoredQuote({
    quoteConfirmationRequired: false,
    quoteId: "",
    expiresAt: "",
    confirmedByUserId: "",
    nowMs: quoteNow,
  }),
  "missing",
);
const beforeQuote = planProceedsAfterQuote({
  quote: "missing",
  principalMinor: 3500,
  payoutFeeMinor: 0,
  chargeNetMinor: 3900,
  postedMinor: 0,
  pendingMinor: 0,
});
assert.equal(beforeQuote.action, "prepare_quote");
const quoted = planProceedsAfterQuote({
  quote: "usable",
  principalMinor: 3500,
  payoutFeeMinor: 200,
  chargeNetMinor: 3900,
  postedMinor: 0,
  pendingMinor: 0,
});
assert.equal(quoted.action, "fund");
assert.equal(quoted.amountMinor, 3700);
const quotedDone = planProceedsAfterQuote({
  quote: "usable",
  principalMinor: 3500,
  payoutFeeMinor: 200,
  chargeNetMinor: 3900,
  postedMinor: 3700,
  pendingMinor: 0,
});
assert.equal(quotedDone.action, "complete");
assert.equal(
  planProceedsAfterQuote({
    quote: "usable",
    principalMinor: 3500,
    payoutFeeMinor: 500,
    chargeNetMinor: 3900,
    postedMinor: 0,
    pendingMinor: 0,
  }).action,
  "short",
);
assert.equal(
  planProceedsAfterQuote({
    quote: "expired",
    principalMinor: 3500,
    payoutFeeMinor: 400,
    chargeNetMinor: 3900,
    postedMinor: 0,
    pendingMinor: 3700,
  }).action,
  "wait_inflight",
);
assert.equal(
  planProceedsAfterQuote({
    quote: "expired",
    principalMinor: 3500,
    payoutFeeMinor: 200,
    chargeNetMinor: 3900,
    postedMinor: 3500,
    pendingMinor: 0,
  }).action,
  "prepare_quote",
);
const feeDelta = planProceedsAfterQuote({
  quote: "usable",
  principalMinor: 3500,
  payoutFeeMinor: 200,
  chargeNetMinor: 3900,
  postedMinor: 3500,
  pendingMinor: 0,
});
assert.equal(feeDelta.action, "fund");
assert.equal(feeDelta.amountMinor, 200);
assert.equal(
  planProceedsAfterQuote({
    quote: "usable",
    principalMinor: 3500,
    payoutFeeMinor: 100,
    chargeNetMinor: 3900,
    postedMinor: 3700,
    pendingMinor: 0,
  }).action,
  "complete",
);
assert.equal(
  classifyStoredQuote({
    quoteConfirmationRequired: true,
    quoteId: "",
    expiresAt: "",
    confirmedByUserId: "",
    nowMs: quoteNow,
  }),
  "confirmation_required",
);
assert.equal(
  planProceedsAfterQuote({
    quote: "confirmation_required",
    principalMinor: 3500,
    payoutFeeMinor: 0,
    chargeNetMinor: 3900,
    postedMinor: 0,
    pendingMinor: 0,
  }).action,
  "await_confirmation",
);

const day = STRIPE_IDEMPOTENCY_WINDOW_MS;
const recovered = decideFundingRequest({
  legExistedBeforeThisAttempt: true,
  ageMs: day + 60_000,
  matchingPayoutIds: ["po_saved"],
});
assert.equal(recovered.action, "attach");
assert.equal(recovered.payoutId, "po_saved");
assert.equal(
  decideFundingRequest({
    legExistedBeforeThisAttempt: true,
    ageMs: day + 60_000,
    matchingPayoutIds: [],
  }).action,
  "uncertain",
);
assert.equal(
  decideFundingRequest({
    legExistedBeforeThisAttempt: true,
    ageMs: day - 60_000,
    matchingPayoutIds: [],
  }).action,
  "create_same_key",
);
assert.equal(
  fundingPayoutMatchesLeg(
    {
      id: "po_other",
      amount: 3500,
      currency: "gbp",
      metadata: {},
      payoutMethod: "fa_test",
      automatic: true,
    },
    { id: "leg_1", amountMinor: 3500, currency: "GBP" },
    "fa_test",
  ),
  false,
);
assert.equal(automaticBankPayoutBlocksFunding("daily").blocked, true);
assert.equal(automaticBankPayoutBlocksFunding("").code, "GP_PAYOUT_SCHEDULE_UNREAD");
assert.equal(automaticBankPayoutBlocksFunding("manual").blocked, false);

const fundingProgress = describeGpBuyerPayout({
  releaseAuthorized: true,
  txnStatus: "READY_TO_RELEASE",
  outboundStatus: "AWAITING_FA_FUNDS",
  failureCode: "GP_FA_BALANCE_SHORT",
  fundingStatus: "SHORT",
  chargeAvailable: true,
  fundedAt,
  proceedsFundingEnabled: true,
  now,
});
assert.equal(fundingProgress.phase, "waiting_funding");
assert.equal(fundingProgress.headline, GP_FUNDING_PROGRESS_COPY);
assert.equal(fundingProgress.hideReleaseActions, true);
assert.doesNotMatch(fundingProgress.headline, /once your payment clears/);
assert.doesNotMatch(fundingProgress.timing, /still clearing/);
const processing = describeGpBuyerPayout({
  releaseAuthorized: true,
  txnStatus: "READY_TO_RELEASE",
  outboundStatus: "AWAITING_FA_FUNDS",
  fundingStatus: "FUNDING",
  chargeAvailable: true,
  proceedsFundingEnabled: true,
  now,
});
assert.equal(processing.headline, GP_FUNDING_PROCESSING_COPY);
assert.equal(processing.hideReleaseActions, true);

const shape = await import(
  pathToFileURL(path.join(root, "src/lib/payments/payout-rail/proceeds-preflight-shape.ts")).href
);
const preflight = read("src/lib/payments/payout-rail/proceeds-preflight.ts");
const preflightRoute = read("src/app/api/admin/gp-proceeds-preflight/route.ts");
assert.match(preflightRoute, /requireAdmin/);
assert.match(preflightRoute, /export async function GET/);
assert.doesNotMatch(preflightRoute, /export async function POST/);
assert.match(preflight, /charges\.retrieve/);
assert.match(preflight, /readFinancialAccountBalance\("TEST", "gbp"\)/);
assert.match(preflight, /accounts\.retrieve\(\)/);
assert.match(preflight, /webhookEndpoints\.list/);
assert.doesNotMatch(preflight, /payouts\.create|prepareQuoteOnly|accounts\.update/);
assert.match(preflight, /UNVERIFIED_WRITE_PERMISSIONS/);
assert.equal(
  shape.selectApprovedTestPurchase([
    {
      id: "other",
      buyerId: "buyer",
      sellerId: "sourcer",
      stripeChargeId: "ch_other",
      stripeMode: "LIVE",
      payoutRail: "STRIPE_GLOBAL_PAYOUTS",
      currency: "GBP",
      totalChargeMinor: 3745,
      status: "RELEASED",
    },
  ]),
  null,
);
assert.deepEqual(
  shape.webhookEventCoverage(["payment_intent.succeeded"], ["payment_intent.succeeded", "payout.paid"]),
  { covered: ["payment_intent.succeeded"], missing: ["payout.paid"] },
);
const liveCharge = shape.safeChargeFacts({
  id: "ch_live_example",
  livemode: true,
  currency: "gbp",
  grossMinor: 4025,
  feeMinor: 100,
  netMinor: 3925,
  balanceStatus: "available",
  availableOn: null,
});
assert.equal(liveCharge.blocked, "mode_mismatch");
assert.equal("facts" in liveCharge, false);

console.log("gp proceeds funding: ok");
