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
  GP_FUNDING_CHECKING_COPY,
  GP_FUNDING_CONFIRMED_COPY,
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
  fundingPayoutCreateGate,
  fundingScanIncludesPurchase,
  GP_TEST_REPAIR_ABANDONED,
  isTestRepairAbandoned,
  fundingIdempotencyKey,
  fundingPayoutMatchesLeg,
  isSimulatedFundingCredit,
  matchFundingCredit,
  proceedsFundingAllowsOutbound,
  fundingRowAfterCompletedPurchase,
  classifyGpAwaitingFunds,
  gpAwaitingFundsHeadline,
  gpAwaitingFundsListPhrase,
  redactReceivedCreditInventory,
  nextFundingLegSequence,
  otherGpAvailableUnpaidMinor,
  planProceedsAfterQuote,
  assessChargePayoutMembership,
  balanceTransactionObjectHasPayoutProperty,
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
    chargePayoutMembership: { state: "clear" },
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
assert.match(runner, /otherGpAvailableUnpaidMinor/);
assert.match(runner, /assessChargePayoutMembership/);
assert.match(runner, /listAutomaticPayoutBalanceTransactions/);
assert.match(runner, /balanceTransactions\.list/);
assert.match(read("src/lib/payments/payout-rail/proceeds-funding.ts"), /GP_CHARGE_PAID_OUT/);
assert.match(read("src/lib/payments/payout-rail/proceeds-funding.ts"), /GP_CHARGE_PAYOUT_UNREAD/);
assert.match(runner, /withPlatformBalanceLock/);
assert.match(runner, /fencedProviderWrite/);
assert.doesNotMatch(runner, /bt\?\.payout|paidOutPayoutId/);
const reconcileBody = runner.slice(runner.indexOf("export async function reconcileGpProceedsFunding"));
assert.ok(reconcileBody.indexOf("if (!opts.lockHeld)") < reconcileBody.indexOf("withPlatformBalanceLock"));
const btTypes = read("node_modules/stripe/types/BalanceTransactions.d.ts");
assert.match(btTypes, /interface BalanceTransaction \{/);
assert.doesNotMatch(btTypes, /payout\?:/);
assert.match(read("node_modules/stripe/types/BalanceTransactionsResource.d.ts"), /For automatic Stripe payouts only/);
assert.equal(balanceTransactionObjectHasPayoutProperty(["id", "net", "status", "available_on", "type"]), false);
assert.equal(balanceTransactionObjectHasPayoutProperty(["id", "payout"]), true);
assert.doesNotMatch(read("src/lib/payments/payout-rail/quote-confirmation.ts"), /Stripe has not disclosed/);
assert.match(read("src/lib/payments/payout-rail/quote-confirmation.ts"), /app policy/);
assert.doesNotMatch(read("src/lib/payments/payout-rail/live-pilot.ts"), /Stripe has not disclosed/);
assert.match(read("src/lib/payments/payout-rail/live-pilot.ts"), /Stripe does not require/);
assert.match(read("src/lib/payments/tickets.ts"), /proceedsFundingEnabled: isGlobalPayoutsProceedsFundingEnabled\(\)/);
assert.match(read("src/lib/payments/fulfilment.ts"), /proceedsFundingEnabled: isGlobalPayoutsProceedsFundingEnabled\(\)/);
assert.match(GP_RELEASE_WAITING_COPY, /is available/);
assert.doesNotMatch(GP_RELEASE_WAITING_COPY, /clears|cleared/);
assert.match(GP_FUNDING_PROGRESS_COPY, /is available/);
assert.match(GP_FUNDING_PROGRESS_COPY, /waiting to fund/);
assert.doesNotMatch(GP_FUNDING_PROGRESS_COPY, /cleared|is funding|being processed/);
assert.match(GP_FUNDING_PROCESSING_COPY, /is funding/);
assert.doesNotMatch(GP_FUNDING_PROCESSING_COPY, /being processed|within three days/);
assert.equal(GP_FUNDING_CHECKING_COPY, "Release confirmed. Checking payout status. No further action is needed.");
const fundBody = runner.slice(runner.indexOf("async function fundOne"), runner.indexOf("async function confirmLegs"));
assert.ok(fundBody.indexOf("pendingLegs.length") < fundBody.indexOf("GP_FUNDING_ALREADY_COMPLETED"));
assert.ok(fundBody.indexOf("GP_FUNDING_ALREADY_COMPLETED") < fundBody.indexOf("prepareFundingQuote"));
assert.ok(
  fundBody.indexOf("assessChargePayoutMembership") >= 0 &&
    fundBody.indexOf("assessChargePayoutMembership") < fundBody.indexOf("prepareFundingQuote"),
);
let sendCursor = 0;
while (sendCursor >= 0) {
  const sendAt = fundBody.indexOf("sendFundingPayout", sendCursor);
  if (sendAt < 0) break;
  const prior = fundBody.lastIndexOf("newFundingAllowedNow", sendAt);
  assert.ok(prior >= 0 && sendAt - prior < 500);
  sendCursor = sendAt + 1;
}
assert.match(runner, /posted < principal \+ fees/);
assert.match(runner, /fundingPayoutCreateGate/);
const sendFn = runner.slice(
  runner.indexOf("async function sendFundingPayout"),
  runner.indexOf("async function prepareFundingQuote"),
);
assert.ok(sendFn.indexOf("accounts.retrieve") < sendFn.indexOf("payouts.create"));
assert.ok(sendFn.indexOf("fundingPayoutCreateGate") < sendFn.indexOf("payouts.create"));
assert.ok(sendFn.indexOf("fencedProviderWrite") < sendFn.indexOf("payouts.create"));
assert.match(sendFn, /idempotencyKey: opts.leg.idempotencyKey/);
assert.match(sendFn, /status: "BLOCKED"/);
assert.match(sendFn, /kind: "block"/);
assert.doesNotMatch(sendFn, /idempotencyKey:\s*`/);
assert.ok(fundBody.indexOf('action === "attach"') < fundBody.indexOf("sendFundingPayout"));
assert.ok(fundBody.indexOf("confirmLegs") < fundBody.indexOf("sendFundingPayout"));

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
assert.match(cron, /coordinatePlatformBalance\(\{ stripeMode: "LIVE" \}\)/);
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
assert.match(card, /GP_FUNDING_CHECKING_COPY/);
assert.doesNotMatch(card, /GP_FUNDING_HOLD_COPY/);
assert.doesNotMatch(card, /continues automatically/);
assert.match(card, /releaseHold/);
const purchases = read("src/app/profile/purchases/page.tsx");
assert.match(purchases, /gpPayoutProgress\?\.hideReleaseActions/);
assert.match(purchases, /GP_FUNDING_CHECKING_COPY/);
assert.doesNotMatch(purchases, /GP_FUNDING_HOLD_COPY/);
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

const nowForReserve = new Date("2026-10-23T08:10:00.000Z");
const newAvailable = {
  chargeNetMinor: 3904,
  status: "SHORT",
  failureCode: "GP_FUNDING_ROOM",
  availableOn: new Date("2026-10-23T08:08:57.000Z"),
  txnStatus: "FUNDED",
  outboundStatuses: [],
  postedMinor: 0,
  pendingMinor: 0,
};
const delayedPending = {
  chargeNetMinor: 3878,
  status: "AWAITING_SETTLEMENT",
  failureCode: "GP_CHARGE_PENDING",
  availableOn: new Date("2026-10-29T00:00:00.000Z"),
  txnStatus: "READY_TO_RELEASE",
  outboundStatuses: ["AWAITING_FA_FUNDS"],
  postedMinor: 0,
  pendingMinor: 0,
};
assert.equal(otherGpAvailableUnpaidMinor([newAvailable, delayedPending], nowForReserve).minor, 3904);
assert.equal(otherGpAvailableUnpaidMinor([newAvailable, delayedPending], nowForReserve).code, null);
const oldConsumingNew = allocateGpProceedsFunding(
  input({
    charge: charge({ netMinor: 3878 }),
    platformAvailableMinor: 3904,
    reservedMinor: otherGpAvailableUnpaidMinor([newAvailable, delayedPending], nowForReserve).minor,
    payoutFeeMinor: 138,
  }),
);
assert.equal(oldConsumingNew.action, "wait");
assert.equal(oldConsumingNew.code, "GP_FUNDING_ROOM");
assert.equal(otherGpAvailableUnpaidMinor([delayedPending], nowForReserve).minor, 0);
assert.equal(otherGpAvailableUnpaidMinor([], nowForReserve, 1).code, "GP_RESERVE_UNKNOWN");
const completedInflight = otherGpAvailableUnpaidMinor(
  [
    {
      chargeNetMinor: 3878,
      status: "FUNDING",
      failureCode: "",
      availableOn: new Date("2026-10-17T00:00:00.000Z"),
      txnStatus: "RELEASED",
      outboundStatuses: ["SUCCEEDED"],
      postedMinor: 0,
      pendingMinor: 3638,
    },
  ],
  nowForReserve,
);
assert.equal(completedInflight.minor, 240);
const alreadyFundedPosted = otherGpAvailableUnpaidMinor(
  [
    {
      chargeNetMinor: 3878,
      status: "POSTED",
      failureCode: "",
      availableOn: new Date("2026-10-17T00:00:00.000Z"),
      txnStatus: "RELEASED",
      outboundStatuses: ["SUCCEEDED"],
      postedMinor: 3638,
      pendingMinor: 0,
    },
  ],
  nowForReserve,
);
assert.equal(alreadyFundedPosted.minor, 0);
const pendingLegReserve = otherGpAvailableUnpaidMinor(
  [
    {
      ...newAvailable,
      status: "FUNDING",
      failureCode: "",
      pendingMinor: 3638,
    },
  ],
  nowForReserve,
);
assert.equal(pendingLegReserve.minor, 266);
const uncertainPending = otherGpAvailableUnpaidMinor(
  [
    {
      ...newAvailable,
      status: "FUNDING",
      failureCode: "GP_FUNDING_OUTCOME_UNCERTAIN",
      pendingMinor: 3638,
    },
  ],
  nowForReserve,
);
assert.equal(uncertainPending.minor, 266);
const uncertainNoLeg = otherGpAvailableUnpaidMinor(
  [
    {
      ...newAvailable,
      status: "FUNDING",
      failureCode: "GP_FUNDING_OUTCOME_UNCERTAIN",
      pendingMinor: 0,
    },
  ],
  nowForReserve,
);
assert.equal(uncertainNoLeg.minor, 3904);
const sweptSibling = {
  chargeNetMinor: 3878,
  status: "SHORT",
  failureCode: "GP_CHARGE_PAID_OUT",
  availableOn: new Date("2026-10-17T00:00:00.000Z"),
  txnStatus: "READY_TO_RELEASE",
  outboundStatuses: [],
  postedMinor: 0,
  pendingMinor: 0,
};
assert.equal(otherGpAvailableUnpaidMinor([sweptSibling, newAvailable], nowForReserve).minor, 3904);
assert.equal(GP_TEST_REPAIR_ABANDONED, "GP_TEST_REPAIR_ABANDONED");
assert.equal(isTestRepairAbandoned({ stripeMode: "TEST", failureCode: GP_TEST_REPAIR_ABANDONED }), true);
assert.equal(isTestRepairAbandoned({ stripeMode: "LIVE", failureCode: GP_TEST_REPAIR_ABANDONED }), false);
assert.equal(isTestRepairAbandoned({ stripeMode: "TEST", failureCode: "GP_FUNDING_ROOM" }), false);
const abandonedTest = {
  ...newAvailable,
  status: "BLOCKED",
  failureCode: GP_TEST_REPAIR_ABANDONED,
  stripeMode: "TEST",
};
const ordinaryUnpaid = { ...newAvailable, stripeMode: "TEST" };
const liveMislabel = {
  ...newAvailable,
  failureCode: GP_TEST_REPAIR_ABANDONED,
  stripeMode: "LIVE",
};
assert.equal(otherGpAvailableUnpaidMinor([abandonedTest], nowForReserve).minor, 0);
assert.equal(otherGpAvailableUnpaidMinor([ordinaryUnpaid], nowForReserve).minor, 3904);
assert.equal(otherGpAvailableUnpaidMinor([abandonedTest, ordinaryUnpaid], nowForReserve).minor, 3904);
assert.equal(otherGpAvailableUnpaidMinor([liveMislabel], nowForReserve).minor, 3904);
assert.equal(
  fundingScanIncludesPurchase({
    txnStatus: "READY_TO_RELEASE",
    outboundStatuses: ["AWAITING_FA_FUNDS"],
    hasPendingFundingLeg: false,
    stripeMode: "TEST",
    failureCode: GP_TEST_REPAIR_ABANDONED,
  }),
  false,
);
assert.equal(
  fundingScanIncludesPurchase({
    txnStatus: "READY_TO_RELEASE",
    outboundStatuses: ["AWAITING_FA_FUNDS"],
    hasPendingFundingLeg: false,
    stripeMode: "LIVE",
    failureCode: GP_TEST_REPAIR_ABANDONED,
  }),
  true,
);
assert.equal(
  fundingScanIncludesPurchase({
    txnStatus: "READY_TO_RELEASE",
    outboundStatuses: ["AWAITING_FA_FUNDS"],
    hasPendingFundingLeg: true,
    stripeMode: "TEST",
    failureCode: GP_TEST_REPAIR_ABANDONED,
  }),
  true,
);
assert.match(runner, /stripeMode: "TEST"/);
assert.match(runner, /isTestRepairAbandoned/);
assert.doesNotMatch(runner, /resumeAuthorizedProcurement/);
assert.match(runner, /recoverUncertainInitiatedOutbound/);
assert.match(runner, /postedMinor >= requiredMinor/);
assert.match(runner, /status: "POSTED", failureCode: ""/);
assert.match(runner, /GP_TEST_REPAIR_ABANDONED/);
const absentObjectField = assessChargePayoutMembership({
  balanceTransactionId: "txn_charge_new",
  payoutLists: [
    {
      payoutId: "po_auto_hist",
      automatic: true,
      listed: true,
      balanceTransactionIds: ["txn_other"],
    },
  ],
});
assert.equal(absentObjectField.state, "clear");
const unreadMeansUnknown = allocateGpProceedsFunding(
  input({
    charge: charge({ netMinor: 3878 }),
    platformAvailableMinor: 3904,
    reservedMinor: 0,
    payoutFeeMinor: 138,
    chargePayoutMembership: null,
  }),
);
assert.equal(unreadMeansUnknown.action, "wait");
assert.equal(unreadMeansUnknown.code, "GP_CHARGE_PAYOUT_UNREAD");
const sweptByAutomatic = assessChargePayoutMembership({
  balanceTransactionId: "txn_old",
  ownFundingPayoutIds: ["po_own_fa"],
  payoutLists: [
    {
      payoutId: "po_auto_bank",
      automatic: true,
      listed: true,
      balanceTransactionIds: ["txn_old"],
    },
  ],
});
assert.equal(sweptByAutomatic.state, "paid_out");
const sweptConsumingNew = allocateGpProceedsFunding(
  input({
    charge: charge({ netMinor: 3878 }),
    platformAvailableMinor: 3904,
    reservedMinor: 0,
    payoutFeeMinor: 138,
    chargePayoutMembership: sweptByAutomatic,
  }),
);
assert.equal(sweptConsumingNew.action, "wait");
assert.equal(sweptConsumingNew.code, "GP_CHARGE_PAID_OUT");
const ownFundingPayout = allocateGpProceedsFunding(
  input({
    charge: charge({ netMinor: 3904 }),
    platformAvailableMinor: 3904,
    payoutFeeMinor: 138,
    chargePayoutMembership: assessChargePayoutMembership({
      balanceTransactionId: "txn_new",
      ownFundingPayoutIds: ["po_own_fa"],
      payoutLists: [
        {
          payoutId: "po_own_fa",
          automatic: true,
          listed: true,
          balanceTransactionIds: ["txn_new"],
        },
      ],
    }),
  }),
);
assert.equal(ownFundingPayout.action, "fund");
assert.equal(ownFundingPayout.amountMinor, 3638);
const unreadAutomaticList = assessChargePayoutMembership({
  balanceTransactionId: "txn_new",
  payoutLists: [{ payoutId: "po_auto", automatic: true, listed: false, balanceTransactionIds: [] }],
});
assert.equal(unreadAutomaticList.state, "unread");
const manualPayoutIsNotListEvidence = assessChargePayoutMembership({
  balanceTransactionId: "txn_new",
  payoutLists: [
    {
      payoutId: "po_manual_fa",
      automatic: false,
      listed: true,
      balanceTransactionIds: ["txn_new"],
    },
  ],
});
assert.equal(manualPayoutIsNotListEvidence.state, "clear");
assert.equal(
  classifyStoredQuote({
    quoteConfirmationRequired: true,
    quoteId: "q_live",
    expiresAt: "2026-10-23T08:15:17.000Z",
    confirmedByUserId: "buyer",
    nowMs: Date.parse("2026-10-23T08:16:00.000Z"),
  }),
  "confirmation_required",
);
assert.equal(
  classifyStoredQuote({
    quoteConfirmationRequired: false,
    quoteId: "q_test",
    expiresAt: "2026-10-23T09:36:16.000Z",
    confirmedByUserId: "",
    nowMs: Date.parse("2026-10-23T09:37:00.000Z"),
  }),
  "expired",
);

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
  matchCredit({
    credits: [receivedCredit({ balance_transfer: { type: "payout", payout: "po_1" } })],
  }).creditId,
  "rc_real",
);
assert.equal(
  matchCredit({
    credits: [
      receivedCredit({
        balance_transfer: { type: "payout", payout: "po_1", payout_v1: "po_1" },
      }),
    ],
  }).creditId,
  "rc_real",
);
assert.equal(
  matchCredit({
    credits: [
      receivedCredit({
        balance_transfer: { type: "payout", payout: "po_1", payout_v1: "po_other" },
      }),
    ],
  }),
  null,
);
assert.equal(
  matchCredit({
    credits: [
      receivedCredit({
        id: "rc_amount_only",
        description: "po_1",
        balance_transfer: { type: "payout" },
      }),
    ],
  }),
  null,
);
const inventory = redactReceivedCreditInventory({
  credits: [
    receivedCredit({ balance_transfer: { type: "payout", payout: "po_1" } }),
    receivedCredit({ id: "rc_legacy", balance_transfer: { type: "payout_v1", payout_v1: "po_2" } }),
  ],
  financialAccountId: "fa_test",
  amountMinor: 3500,
});
assert.equal(inventory.listed, 2);
assert.equal(inventory.hasPayoutField, true);
assert.equal(inventory.hasPayoutV1Field, true);
assert.deepEqual(inventory.transferKeys, ["payout", "payout_v1", "type"]);
assert.equal(inventory.amountMatches, 2);
assert.equal(
  proceedsFundingAllowsOutbound({
    payoutRail: "STRIPE_CONNECT",
    proceedsFundingEnabled: true,
    funding: null,
    requiredMinor: 3638,
  }).ok,
  true,
);
assert.equal(
  proceedsFundingAllowsOutbound({
    payoutRail: "STRIPE_GLOBAL_PAYOUTS",
    proceedsFundingEnabled: false,
    funding: null,
    requiredMinor: 3638,
  }).ok,
  true,
);
assert.equal(
  proceedsFundingAllowsOutbound({
    payoutRail: "STRIPE_GLOBAL_PAYOUTS",
    proceedsFundingEnabled: true,
    funding: null,
    requiredMinor: 3638,
  }).ok,
  false,
);
assert.equal(
  proceedsFundingAllowsOutbound({
    payoutRail: "STRIPE_GLOBAL_PAYOUTS",
    proceedsFundingEnabled: true,
    funding: {
      status: "FUNDING",
      postedMinor: 0,
      pendingMinor: 3638,
      postedLegsHaveCredit: false,
    },
    requiredMinor: 3638,
  }).code,
  "GP_PURCHASE_FUNDING_UNCONFIRMED",
);
assert.equal(
  proceedsFundingAllowsOutbound({
    payoutRail: "STRIPE_GLOBAL_PAYOUTS",
    proceedsFundingEnabled: true,
    funding: {
      status: "POSTED",
      postedMinor: 3638,
      pendingMinor: 0,
      postedLegsHaveCredit: false,
    },
    requiredMinor: 3638,
  }).ok,
  false,
);
assert.equal(
  proceedsFundingAllowsOutbound({
    payoutRail: "STRIPE_GLOBAL_PAYOUTS",
    proceedsFundingEnabled: true,
    funding: {
      status: "POSTED",
      postedMinor: 3638,
      pendingMinor: 0,
      postedLegsHaveCredit: true,
    },
    requiredMinor: 3638,
  }).ok,
  true,
);
assert.equal(
  fundingRowAfterCompletedPurchase({
    postedMinor: 3638,
    pendingMinor: 0,
    requiredMinor: 3638,
    postedLegsHaveCredit: true,
  }).status,
  "POSTED",
);
assert.equal(
  fundingRowAfterCompletedPurchase({
    postedMinor: 0,
    pendingMinor: 0,
    requiredMinor: 3638,
    postedLegsHaveCredit: false,
  }).failureCode,
  "GP_FUNDING_ALREADY_COMPLETED",
);
assert.equal(
  fundingRowAfterCompletedPurchase({
    postedMinor: 3638,
    pendingMinor: 3638,
    requiredMinor: 3638,
    postedLegsHaveCredit: false,
  }).status,
  "unchanged",
);
const creditsClient = read("src/lib/payments/payout-rail/received-credits.ts");
assert.match(creditsClient, /2026-08-26\.preview/);
assert.match(creditsClient, /RECEIVED_CREDITS_LIST_PATH/);
assert.doesNotMatch(creditsClient, /limit=100/);
assert.match(creditsClient, /opts\.limit <= 10/);
assert.match(creditsClient, /receivedCreditsListPath\(\)/);
assert.match(creditsClient, /receivedCreditRetrievePath/);
assert.match(read("src/lib/payments/payout-rail/proceeds-funding-run.ts"), /listReceivedCredits/);
assert.match(read("src/lib/payments/payout-rail/proceeds-funding-run.ts"), /fundingRowAfterCompletedPurchase/);
assert.doesNotMatch(
  read("src/lib/payments/payout-rail/proceeds-funding-run.ts"),
  /received_credits\?limit=/,
);

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
assert.equal(automaticBankPayoutBlocksFunding("weekly").blocked, true);
assert.equal(automaticBankPayoutBlocksFunding("monthly").blocked, true);
assert.equal(automaticBankPayoutBlocksFunding("").code, "GP_PAYOUT_SCHEDULE_UNREAD");
assert.equal(automaticBankPayoutBlocksFunding("manual").blocked, false);
assert.equal(
  fundingPayoutCreateGate({ alreadySubmitted: true, scheduleInterval: "daily" }).action,
  "reconcile",
);
assert.equal(
  fundingPayoutCreateGate({ alreadySubmitted: false, scheduleInterval: "daily" }).action,
  "block",
);
assert.equal(
  fundingPayoutCreateGate({ alreadySubmitted: false, scheduleInterval: "daily" }).code,
  "GP_AUTOMATIC_BANK_PAYOUT",
);
assert.equal(
  fundingPayoutCreateGate({ alreadySubmitted: false, scheduleInterval: "weekly" }).code,
  "GP_AUTOMATIC_BANK_PAYOUT",
);
assert.equal(
  fundingPayoutCreateGate({ alreadySubmitted: false, scheduleInterval: "monthly" }).code,
  "GP_AUTOMATIC_BANK_PAYOUT",
);
assert.equal(
  fundingPayoutCreateGate({ alreadySubmitted: false, scheduleInterval: null }).code,
  "GP_PAYOUT_SCHEDULE_UNREAD",
);
assert.equal(
  fundingPayoutCreateGate({
    alreadySubmitted: false,
    scheduleInterval: "manual",
    scheduleReadFailed: true,
  }).code,
  "GP_PAYOUT_SCHEDULE_UNREAD",
);
assert.equal(
  fundingPayoutCreateGate({ alreadySubmitted: false, scheduleInterval: "manual" }).action,
  "create",
);

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
assert.doesNotMatch(fundingProgress.headline, /is funding|being processed|automatically/);
assert.equal(classifyGpAwaitingFunds({}), "unknown");
assert.equal(classifyGpAwaitingFunds({ proceedsFundingEnabled: false }), "review");
assert.equal(classifyGpAwaitingFunds({ configurationBlocked: true }), "review");
assert.equal(classifyGpAwaitingFunds({ failureCode: "GP_INITIATION_DISABLED" }), "review");
assert.equal(classifyGpAwaitingFunds({ chargeAvailable: false }), "payment_pending");
assert.equal(classifyGpAwaitingFunds({ fundingStatus: "AWAITING_SETTLEMENT" }), "payment_pending");
assert.equal(classifyGpAwaitingFunds({ chargeAvailable: true }), "funding_awaited");
assert.equal(classifyGpAwaitingFunds({ fundingStatus: "SHORT" }), "funding_awaited");
assert.equal(classifyGpAwaitingFunds({ fundingStatus: "FUNDING" }), "funding_in_progress");
assert.equal(classifyGpAwaitingFunds({ fundingStatus: "POSTED" }), "funding_confirmed");
assert.equal(gpAwaitingFundsHeadline("unknown"), GP_FUNDING_CHECKING_COPY);
assert.equal(gpAwaitingFundsHeadline("payment_pending"), GP_RELEASE_WAITING_COPY);
assert.equal(gpAwaitingFundsHeadline("review"), GP_FUNDING_HOLD_COPY);
assert.equal(gpAwaitingFundsHeadline("funding_in_progress"), GP_FUNDING_PROCESSING_COPY);
assert.equal(gpAwaitingFundsHeadline("funding_awaited"), GP_FUNDING_PROGRESS_COPY);
assert.equal(gpAwaitingFundsHeadline("funding_confirmed"), GP_FUNDING_CONFIRMED_COPY);
assert.match(gpAwaitingFundsListPhrase("payment_pending"), /become available/);
assert.match(gpAwaitingFundsListPhrase("unknown"), /checking payout status/);
assert.doesNotMatch(gpAwaitingFundsHeadline("payment_pending"), /within three days of release/);
assert.doesNotMatch(gpAwaitingFundsHeadline("funding_in_progress"), /within three days of release/);
assert.doesNotMatch(gpAwaitingFundsListPhrase("funding_in_progress"), /three days/);
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
const checking = describeGpBuyerPayout({
  releaseAuthorized: true,
  txnStatus: "READY_TO_RELEASE",
  outboundStatus: "AWAITING_FA_FUNDS",
  proceedsFundingEnabled: true,
  now,
});
assert.equal(checking.phase, "checking");
assert.equal(checking.headline, GP_FUNDING_CHECKING_COPY);
assert.equal(checking.hideReleaseActions, true);
const postedFunding = describeGpBuyerPayout({
  releaseAuthorized: true,
  txnStatus: "READY_TO_RELEASE",
  outboundStatus: "AWAITING_FA_FUNDS",
  fundingStatus: "POSTED",
  chargeAvailable: true,
  proceedsFundingEnabled: true,
  now,
});
assert.equal(postedFunding.headline, GP_FUNDING_CONFIRMED_COPY);
assert.equal(postedFunding.hideReleaseActions, true);
const postedSending = describeGpBuyerPayout({
  releaseAuthorized: true,
  txnStatus: "READY_TO_RELEASE",
  outboundStatus: "PROCESSING",
  outboundIdPresent: true,
  fundingStatus: "POSTED",
  proceedsFundingEnabled: true,
  now,
});
assert.equal(postedSending.phase, "sending");
assert.equal(postedSending.hideReleaseActions, true);

const shape = await import(
  pathToFileURL(path.join(root, "src/lib/payments/payout-rail/proceeds-preflight-shape.ts")).href
);
const preflight = read("src/lib/payments/payout-rail/proceeds-preflight.ts");
const preflightRoute = read("src/app/api/admin/gp-proceeds-preflight/route.ts");
assert.match(preflightRoute, /requireAdmin/);
assert.match(preflightRoute, /export async function GET/);
assert.doesNotMatch(preflightRoute, /export async function POST/);
assert.match(preflight, /charges\.retrieve/);
assert.match(preflight, /payoutPropertyPresent/);
assert.match(preflight, /filterAutomaticOnly/);
assert.match(preflight, /balanceTransactions\.list/);
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
assert.equal(shape.DAMAGED_GP_TEST_PURCHASE_REF.txnHash, "b8444fb7");
assert.equal(
  shape.selectDamagedTestPurchase([
    {
      id: "other",
      buyerId: "buyer",
      sellerId: "sourcer",
      stripeChargeId: "ch_other",
      stripeMode: "TEST",
      payoutRail: "STRIPE_GLOBAL_PAYOUTS",
      currency: "GBP",
      totalChargeMinor: 4025,
      status: "READY_TO_RELEASE",
    },
  ]),
  null,
);

const recovery = await import(
  pathToFileURL(path.join(root, "src/lib/payments/payout-rail/test-recovery-preview.ts")).href
);
const blockedBySiblingPending = recovery.planDamagedGpTestRecovery({
  membershipState: "clear",
  postedMinor: 0,
  pendingMinor: 0,
  leftoverAvailableMinor: 266,
  siblingPendingLegMinor: 3638,
});
assert.equal(blockedBySiblingPending.requiredMinor, 3638);
assert.equal(blockedBySiblingPending.minimumRestoreMinor, 3372);
assert.equal(blockedBySiblingPending.restoreCardMinor, 3638);
assert.equal(blockedBySiblingPending.canOwnChargeFundAfterRestore, false);
assert.deepEqual(blockedBySiblingPending.recommended, ["reconcile_sibling_pending_leg", "restore_test_card_room"]);
const afterReconcile = recovery.planDamagedGpTestRecovery({
  membershipState: "clear",
  postedMinor: 0,
  pendingMinor: 0,
  leftoverAvailableMinor: 266,
  siblingPendingLegMinor: 0,
});
assert.equal(afterReconcile.minimumRestoreMinor, 3372);
assert.equal(afterReconcile.restoreCardMinor, 3638);
assert.equal(afterReconcile.canOwnChargeFundAfterRestore, true);
assert.equal(afterReconcile.options.find((row) => row.id === "restore_test_card_room").ownChargeProof, false);
const paidOut = recovery.planDamagedGpTestRecovery({
  membershipState: "paid_out",
  postedMinor: 0,
  pendingMinor: 0,
  leftoverAvailableMinor: 266,
  siblingPendingLegMinor: 0,
});
assert.equal(paidOut.canOwnChargeFundAfterRestore, false);
assert.equal(paidOut.options.find((row) => row.id === "substitute_fa_credit").supported, true);
assert.equal(paidOut.options.find((row) => row.id === "leave_short_keep_obligation").supported, true);

const recoveryRoute = read("src/app/api/admin/gp-test-recovery-preview/route.ts");
assert.match(recoveryRoute, /requireAdmin/);
assert.match(recoveryRoute, /export async function GET/);
assert.match(recoveryRoute, /confirm_sibling_leg/);
assert.match(recoveryRoute, /confirmTestSiblingFundingLeg/);
assert.match(recoveryRoute, /abandon_damaged_test_funding/);
assert.match(recoveryRoute, /abandonDamagedTestFundingRow/);
assert.doesNotMatch(recoveryRoute, /payouts\.create|topups\.create|charges\.create/);
const recoveryRun = read("src/lib/payments/payout-rail/test-recovery-run.ts");
assert.match(recoveryRun, /selectDamagedTestPurchase/);
assert.match(recoveryRun, /matchFundingCredit/);
assert.match(recoveryRun, /listReceivedCredits/);
assert.match(recoveryRun, /retrieveReceivedCredit/);
assert.match(recoveryRun, /storedCreditVerified/);
assert.match(recoveryRun, /redactReceivedCreditInventory/);
assert.match(recoveryRun, /creditListHttpStatus/);
assert.match(recoveryRun, /siblingFailureCode/);
assert.match(recoveryRun, /abandonDamagedTestFundingRow/);
assert.match(recoveryRun, /withPlatformBalanceLock/);
assert.match(recoveryRun, /GP_TEST_REPAIR_ABANDONED/);
assert.doesNotMatch(recoveryRun, /payouts\.create|topups\.create|outboundPayments/);

assert.equal(recovery.TEST_REPAIR_TOPUP_CAP_MINOR, 3372);
assert.deepEqual(recovery.decideTestRepairTopupAmount({ requiredMinor: 3638, leftoverAvailableMinor: 266 }), {
  action: "topup",
  amountMinor: 3372,
  code: "RESTORE_PLATFORM_ROOM",
});
assert.deepEqual(recovery.decideTestRepairTopupAmount({ requiredMinor: 3638, leftoverAvailableMinor: 3638 }), {
  action: "none",
  amountMinor: 0,
  code: "ALREADY_FUNDED_ROOM",
});
assert.deepEqual(recovery.decideTestRepairTopupAmount({ requiredMinor: 3638, leftoverAvailableMinor: 0 }), {
  action: "stop",
  amountMinor: 3638,
  code: "EXCEEDS_CAP",
});
const topupSrc = read("src/lib/payments/payout-rail/test-recovery-topup.ts");
assert.match(topupSrc, /stripe\.topups\.create/);
assert.match(topupSrc, /currency: "gbp"/);
assert.match(topupSrc, /ownChargeProof: "false"/);
assert.doesNotMatch(topupSrc, /charges\.create|paymentIntents\.create|financialAccounts/);
assert.match(read("src/app/api/admin/gp-test-recovery-topup/route.ts"), /restore_platform_balance/);
assert.doesNotMatch(read("src/app/api/admin/gp-test-recovery-topup/route.ts"), /charges\.create/);
const outbound = read("src/lib/payments/payout-rail/outbound-payment.ts");
assert.match(outbound, /proceedsFundingAllowsOutbound/);
assert.match(outbound, /GP_PURCHASE_FUNDING_UNCONFIRMED/);
assert.match(outbound, /gpAwaitingFundsHeadline/);
assert.doesNotMatch(outbound, /GP_FUNDING_HOLD_COPY/);
assert.match(read("src/lib/payments/payout-rail/outbound-display.ts"), /classifyGpAwaitingFunds/);
assert.match(read("src/app/api/payments/confirm-receipt/route.ts"), /GP_FUNDING_CHECKING_COPY/);
assert.match(read("src/lib/payments/payout-rail/proceeds-funding.ts"), /balanceTransferPayoutId/);
assert.match(read("src/lib/payments/payout-rail/proceeds-funding.ts"), /rec\.payout/);
assert.match(read("src/lib/payments/flags.ts"), /envBool\("GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED", false\)/);
assert.match(outbound, /recoverUncertainInitiatedOutbound/);
assert.match(outbound, /matchUncertainOutboundFromList/);
assert.match(outbound, /listUncertainOutboundEvidence/);
assert.match(outbound, /financial_account=/);
assert.match(outbound, /replayOriginalOutboundIdempotency/);
assert.match(outbound, /idempotencyKey: key/);
assert.match(outbound, /attemptCount > 1/);
const verifySrc = read("src/lib/payments/payout-rail/gp-testrun-verify.ts");
assert.match(verifySrc, /matchFundingCredit/);
assert.match(verifySrc, /getStripe\("TEST"\)/);
assert.match(verifySrc, /recoverUncertainInitiatedOutbound/);
assert.match(verifySrc, /isGlobalPayoutsLiveInitiationEnabled/);
assert.doesNotMatch(verifySrc, /idempotencyKey: `/);
assert.match(read("src/app/api/admin/gp-testrun-verify/route.ts"), /recover_uncertain/);

const { matchUncertainOutboundFromList } = await import(
  pathToFileURL(path.join(root, "src/lib/payments/payout-rail/outbound-quote.ts")).href
);
const listedBase = {
  recipient: "rec_1",
  payoutMethod: "pm_1",
  financialAccount: "fa_1",
  amountMinor: 3500,
  currency: "gbp",
};
assert.equal(
  matchUncertainOutboundFromList({
    complete: false,
    payments: [],
    protectedTxnId: "txn_1",
    kind: "FINAL",
    recipientId: "rec_1",
    payoutMethodId: "pm_1",
    financialAccountId: "fa_1",
    amountMinor: 3500,
    currency: "GBP",
  }).action,
  "wait",
);
assert.equal(
  matchUncertainOutboundFromList({
    complete: true,
    payments: [],
    protectedTxnId: "txn_1",
    kind: "FINAL",
    recipientId: "rec_1",
    payoutMethodId: "pm_1",
    financialAccountId: "fa_1",
    amountMinor: 3500,
    currency: "GBP",
  }).code,
  "GP_RECONCILIATION_INCOMPLETE",
);
assert.deepEqual(
  matchUncertainOutboundFromList({
    complete: true,
    payments: [{ ...listedBase, id: "ob_1", metadataTxnId: "txn_1", metadataKind: "FINAL" }],
    protectedTxnId: "txn_1",
    kind: "FINAL",
    recipientId: "rec_1",
    payoutMethodId: "pm_1",
    financialAccountId: "fa_1",
    amountMinor: 3500,
    currency: "GBP",
  }),
  { action: "attach", outboundId: "ob_1" },
);
assert.deepEqual(
  matchUncertainOutboundFromList({
    complete: false,
    payments: [{ ...listedBase, id: "ob_1", metadataTxnId: "txn_1", metadataKind: "FINAL" }],
    protectedTxnId: "txn_1",
    kind: "FINAL",
    recipientId: "rec_1",
    payoutMethodId: "pm_1",
    financialAccountId: "fa_1",
    amountMinor: 3500,
    currency: "GBP",
  }),
  { action: "attach", outboundId: "ob_1" },
);
assert.equal(
  matchUncertainOutboundFromList({
    complete: true,
    payments: [
      { ...listedBase, id: "ob_1", metadataTxnId: "txn_1", metadataKind: "FINAL" },
      { ...listedBase, id: "ob_2", metadataTxnId: "txn_1", metadataKind: "FINAL" },
    ],
    protectedTxnId: "txn_1",
    kind: "FINAL",
    recipientId: "rec_1",
    payoutMethodId: "pm_1",
    financialAccountId: "fa_1",
    amountMinor: 3500,
    currency: "GBP",
  }).code,
  "GP_PAYMENT_AMBIGUOUS",
);

console.log("gp proceeds funding: ok");
