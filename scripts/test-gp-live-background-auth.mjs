/**
 * Durable buyer authorization for LIVE inspection expiry and retries.
 * Provider and database calls are mocked. No network, no Production data,
 * and no remote quote, charge, payout, refund, recipient, or funding.
 *
 * Run: node scripts/test-gp-live-background-auth.mjs
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

if (process.env.SB_GP_LIVE_BACKGROUND_AUTH_TEST !== "1") {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/SECRET|TOKEN|KEY|DATABASE|POSTGRES|NEON|STRIPE|PASSWORD|COOKIE|AUTH/i.test(key)) {
      delete env[key];
    }
  }
  env.SB_GP_LIVE_BACKGROUND_AUTH_TEST = "1";
  env.NODE_ENV = "test";
  env.DATABASE_URL = "postgresql://mock:mock@127.0.0.1:9/mock";
  env.GLOBAL_PAYOUTS_ENABLED = "true";
  env.GLOBAL_PAYOUTS_SANDBOX_ENABLED = "false";
  env.GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED = "false";
  env.LIVE_PAYMENTS_ENABLED = "true";
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", fileURLToPath(import.meta.url)],
    { cwd: root, env, stdio: "inherit" },
  );
  process.exit(result.status ?? 1);
}

const assert = (await import("node:assert/strict")).default;
const {
  evaluateBackgroundQuote,
  evaluateDurableReleaseAuthorization,
  evaluateLivePilotInitiation,
  evaluateQuoteConfirmation,
  globalPayoutsReconciliationAllowed,
  inspectionExpiryMayRelease,
  recordedInspectionDeadlineAllowsRelease,
} = await import("../src/lib/payments/payout-rail/live-pilot.ts");
const {
  backgroundAttemptDecision,
  correctedQuoteRetryKey,
  executeQuotedPayout,
  planQuoteRefreshIdentity,
  quoteIdempotencyKey,
  quoteRefreshRequestKey,
} = await import("../src/lib/payments/payout-rail/outbound-quote.ts");
const {
  isGlobalPayoutsLiveInitiationEnabled,
  isGlobalPayoutsSandboxEnabled,
} = await import("../src/lib/payments/flags.ts");
const { gpQuoteConfirmationRequired } = await import("../src/lib/payments/payout-rail/quote-confirmation.ts");

const buyer = "buyer_user_1";
const sourcer = "sourcer_user_1";
const worker = "worker_user_1";
const txn = "txn_pilot_1";
const recipient = "acct_example";
const method = "thba_test_example";
const fa = "fa_test_example";
const terms = "terms_hash_1";
const now = Date.parse("2026-10-01T08:00:00.000Z");
const paymentKey = "final_gp_txn_hash";
let passed = 0;

function ok(name, cond) {
  assert.equal(Boolean(cond), true, name);
  passed += 1;
  console.log(`PASS ${name}`);
}

function storedQuote(overrides = {}) {
  return {
    v: 1,
    quoteId: "obpq_test_example",
    sourceAmountMinor: 4000,
    sourceCurrency: "gbp",
    destinationCurrency: "thb",
    destinationAmountMinor: 172000,
    expiresAt: "2026-10-01T08:05:00.000Z",
    lockStatus: "active",
    rate: "43.0",
    providerFeeMinor: 2,
    crossBorderFeeMinor: 3,
    fxFeeMinor: 1,
    providerFeeCurrency: "gbp",
    crossBorderFeeCurrency: "gbp",
    fxFeeCurrency: "gbp",
    transactionId: txn,
    recipientId: recipient,
    payoutMethodId: method,
    mode: "LIVE",
    termsHash: terms,
    confirmedByUserId: buyer,
    ...overrides,
  };
}

function quoteBody(id = "obpq_test_fresh") {
  return {
    id,
    object: "v2.money_management.outbound_payment_quote",
    livemode: true,
    amount: { value: 4000, currency: "gbp" },
    from: {
      financial_account: fa,
      debited: { value: 4000, currency: "gbp" },
    },
    to: {
      recipient,
      payout_method: method,
      credited: { value: 172000, currency: "thb" },
    },
    fx_quote: {
      lock_status: "active",
      lock_expires_at: "2026-10-01T08:05:00.000Z",
      to_currency: "thb",
      rates: { gbp: { exchange_rate: "43.0" } },
    },
    estimated_fees: [
      { type: "standard_payout_fee", amount: { value: 2, currency: "gbp" } },
      { type: "cross_border_payout_fee", amount: { value: 3, currency: "gbp" } },
      { type: "foreign_exchange_fee", amount: { value: 1, currency: "gbp" } },
    ],
  };
}

function background(overrides = {}) {
  return {
    buyerId: buyer,
    action: "START_INSPECTION",
    purpose: "INSPECTION_EXPIRY",
    recordedActorUserId: buyer,
    ...overrides,
  };
}

async function runPayout(overrides = {}) {
  const calls = [];
  const persisted = [];
  let marked = 0;
  const result = await executeQuotedPayout({
    sourceAmountMinor: 4000,
    sourceCurrency: "GBP",
    destinationCurrency: "thb",
    financialAccountId: fa,
    recipientId: recipient,
    payoutMethodId: method,
    paymentIdempotencyKey: paymentKey,
    metadata: {
      protectedTxnId: txn,
      kind: "FINAL",
      rail: "STRIPE_GLOBAL_PAYOUTS",
      termsHash: terms,
    },
    mode: "LIVE",
    nowMs: now,
    requiresQuote: true,
    storedSnapshot: JSON.stringify(storedQuote()),
    actorUserId: buyer,
    post: async (req) => {
      calls.push(req);
      if (req.path.endsWith("outbound_payment_quotes")) {
        return { ok: true, status: 200, body: quoteBody(), requestId: "req_quote" };
      }
      return {
        ok: true,
        status: 200,
        body: { id: "obp_test_example", status: "processing" },
        requestId: "req_pay",
      };
    },
    persistQuote: async (snapshot) => {
      persisted.push(snapshot);
    },
    markPaymentSubmission: async () => {
      marked += 1;
    },
    ...overrides,
  });
  return { result, calls, persisted, marked };
}

ok(
  "buyer-present confirmation still requires the confirming buyer",
  evaluateQuoteConfirmation({
    stored: storedQuote(),
    actorUserId: buyer,
    transactionId: txn,
    mode: "LIVE",
    recipientId: recipient,
    payoutMethodId: method,
    sourceAmountMinor: 4000,
    sourceCurrency: "gbp",
    destinationCurrency: "thb",
    termsHash: terms,
    nowMs: now,
  }).ok === true,
);
ok(
  "a worker is not quote confirmation",
  evaluateQuoteConfirmation({
    stored: storedQuote(),
    actorUserId: worker,
    transactionId: txn,
    mode: "LIVE",
    recipientId: recipient,
    payoutMethodId: method,
    sourceAmountMinor: 4000,
    sourceCurrency: "gbp",
    destinationCurrency: "thb",
    termsHash: terms,
    nowMs: now,
  }).code === "GP_QUOTE_ACTOR_MISMATCH",
);

{
  const manual = await runPayout();
  ok("authorized manual release submits one payment", manual.result.ok === true && manual.marked === 1);
  ok("authorized manual release does not create a replacement quote", manual.calls.length === 1);
  ok("manual payment keeps the original idempotency key", manual.calls[0].idempotencyKey === paymentKey);
  ok(
    "manual payment attaches the confirmed quote",
    manual.calls[0].body.outbound_payment_quote === "obpq_test_example",
  );
}

ok(
  "inspection before the deadline is refused",
  inspectionExpiryMayRelease({
    nowMs: now,
    inspectionEndsAtMs: now + 60_000,
    authorized: true,
  }).code === "window_open",
);
ok(
  "inspection after the deadline with a recorded start is allowed",
  inspectionExpiryMayRelease({
    nowMs: now,
    inspectionEndsAtMs: now - 1,
    authorized: true,
  }).ok === true,
);
ok(
  "inspection after the deadline without a recorded start is refused",
  inspectionExpiryMayRelease({
    nowMs: now,
    inspectionEndsAtMs: now - 1,
    authorized: false,
  }).code === "inspection_not_authorized",
);
ok(
  "forged inspection actor is refused",
  evaluateDurableReleaseAuthorization({
    workerActorUserId: null,
    buyerId: buyer,
    recordedActorUserId: sourcer,
    recordedAction: "START_INSPECTION",
    purpose: "INSPECTION_EXPIRY",
  }).code === "inspection_not_authorized",
);
ok(
  "READY_TO_RELEASE alone does not authorize a retry",
  evaluateDurableReleaseAuthorization({
    workerActorUserId: null,
    buyerId: buyer,
    recordedActorUserId: null,
    recordedAction: null,
    purpose: "AUTHORIZED_RETRY",
  }).code === "release_not_authorized",
);
ok(
  "a worker user id cannot stand in for the buyer",
  evaluateDurableReleaseAuthorization({
    workerActorUserId: buyer,
    buyerId: buyer,
    recordedActorUserId: buyer,
    recordedAction: "BUYER_RELEASE_NOW",
    purpose: "AUTHORIZED_RETRY",
  }).code === "GP_WORKER_ACTOR_FORBIDDEN",
);
for (const action of ["BUYER_RELEASE_NOW", "START_INSPECTION"]) {
  ok(
    `${action} retry is authorized for the buyer`,
    evaluateDurableReleaseAuthorization({
      workerActorUserId: null,
      buyerId: buyer,
      recordedActorUserId: buyer,
      recordedAction: action,
      purpose: "AUTHORIZED_RETRY",
    }).ok === true,
  );
}
ok(
  "an unrelated action does not authorize a retry",
  evaluateDurableReleaseAuthorization({
    workerActorUserId: null,
    buyerId: buyer,
    recordedActorUserId: buyer,
    recordedAction: "RELEASE_FINAL",
    purpose: "AUTHORIZED_RETRY",
  }).code === "release_not_authorized",
);

function pilot(overrides = {}) {
  return evaluateLivePilotInitiation({
    mode: "LIVE",
    gpEnabled: true,
    userAllowlistRaw: sourcer,
    userId: sourcer,
    email: "sourcer@example.test",
    countryAllowed: true,
    actorUserId: "",
    buyerId: buyer,
    durableBuyerId: buyer,
    sourceCurrency: "GBP",
    configuredSourceCurrencyRaw: "GBP",
    amountCapRaw: "2500",
    principalMinor: 2000,
    providerFeeMinor: 50,
    crossBorderFeeMinor: 20,
    fxFeeMinor: 80,
    providerFeeCurrency: "gbp",
    crossBorderFeeCurrency: "gbp",
    fxFeeCurrency: "gbp",
    availableBalanceMinor: 4000,
    destinationAmountMinor: 90000,
    destinationCurrency: "THB",
    destinationQuoted: true,
    destinationMinimumsRaw: "THB:60000",
    authorizedTransactionIdRaw: txn,
    transactionId: txn,
    ...overrides,
  });
}
ok("durable buyer authorization passes the actor gate", pilot().ok === true);
ok(
  "filling the actor with the buyer is still refused",
  pilot({ actorUserId: buyer }).code === "GP_PILOT_ACTOR_UNAUTHORIZED",
);
ok(
  "a different durable buyer is refused",
  pilot({ durableBuyerId: sourcer }).code === "GP_PILOT_ACTOR_UNAUTHORIZED",
);
ok(
  "an empty actor without durable authorization is refused",
  pilot({ durableBuyerId: undefined, actorUserId: "" }).code === "GP_PILOT_ACTOR_UNAUTHORIZED",
);
ok(
  "currency guard still applies after durable authorization",
  pilot({ sourceCurrency: "USD" }).code === "GP_PILOT_SOURCE_CURRENCY_INVALID",
);
ok(
  "amount cap still applies after durable authorization",
  pilot({ principalMinor: 3000 }).code === "GP_PILOT_AMOUNT_CAP_EXCEEDED",
);
ok(
  "funding guard still applies after durable authorization",
  pilot({ availableBalanceMinor: 10 }).code === "GP_PILOT_FUNDING_SHORT",
);
ok(
  "destination minimum still applies after durable authorization",
  pilot({ destinationAmountMinor: 1000 }).code === "GP_PILOT_DESTINATION_MINIMUM",
);

{
  const released = await runPayout({
    actorUserId: null,
    backgroundRelease: background(),
    allowQuoteRefresh: true,
  });
  ok("inspection expiry uses the stored unexpired quote", released.result.ok === true);
  ok("inspection expiry does not create a quote", released.persisted.length === 0 && released.calls.length === 1);
  ok("inspection expiry keeps the payment key", released.calls[0].idempotencyKey === paymentKey);
}

{
  const forged = await runPayout({
    actorUserId: null,
    storedSnapshot: JSON.stringify(storedQuote({ expiresAt: "2026-10-01T07:00:00.000Z" })),
    backgroundRelease: background({ recordedActorUserId: sourcer }),
    allowQuoteRefresh: true,
  });
  ok("forged background authorization creates nothing", forged.result.ok === false && forged.calls.length === 0);
  ok("forged background authorization is not a payment", forged.result.code === "inspection_not_authorized");
}

{
  const impersonated = await runPayout({
    actorUserId: buyer,
    backgroundRelease: background(),
    allowQuoteRefresh: true,
  });
  ok("impersonating the buyer creates nothing", impersonated.calls.length === 0);
  ok("impersonating the buyer is forbidden", impersonated.result.code === "GP_WORKER_ACTOR_FORBIDDEN");
}

{
  const refreshId = "0123456789abcdef";
  const refreshKey = quoteRefreshRequestKey(paymentKey, refreshId);
  const expired = await runPayout({
    actorUserId: null,
    storedSnapshot: JSON.stringify(storedQuote({ expiresAt: "2026-10-01T07:00:00.000Z", confirmedByUserId: undefined })),
    backgroundRelease: background({ purpose: "AUTHORIZED_RETRY", action: "BUYER_RELEASE_NOW" }),
    allowQuoteRefresh: true,
    quoteRefreshIdempotencyKey: refreshKey,
  });
  const quoteCall = expired.calls.find((call) => call.path.endsWith("outbound_payment_quotes"));
  const paymentCall = expired.calls.find((call) => call.path.endsWith("outbound_payments"));
  ok("expired authorized quote is refreshed once", expired.result.ok === true && expired.persisted.length === 1);
  ok("refreshed quote uses the persisted refresh key", quoteCall.idempotencyKey === refreshKey);
  ok(
    "refreshed quote does not replay the original quote key",
    quoteCall.idempotencyKey !== quoteIdempotencyKey(paymentKey),
  );
  ok(
    "refreshed quote does not replay the fixed corrected-retry key",
    quoteCall.idempotencyKey !== quoteIdempotencyKey(correctedQuoteRetryKey(paymentKey)),
  );
  ok("refreshed quote keeps the agreed source amount", quoteCall.body.amount.value === 4000 && quoteCall.body.amount.currency === "gbp");
  ok("refreshed quote keeps the recipient and payout method", quoteCall.body.to.recipient === recipient && quoteCall.body.to.payout_method === method);
  ok("payment key is not replaced", paymentCall.idempotencyKey === paymentKey);
  ok("refreshed snapshot is not a manufactured confirmation", expired.persisted[0].confirmedByUserId == null);
  ok("refreshed snapshot keeps the commercial identity", expired.persisted[0].termsHash === terms && expired.persisted[0].transactionId === txn && expired.persisted[0].mode === "LIVE");
  ok("refreshed snapshot records the key that created it", expired.persisted[0].createdIdempotencyKey === refreshKey);
  ok("buyer total inputs stay the stored source amount", expired.persisted[0].sourceAmountMinor === 4000);
}

{
  const replayed = await runPayout({
    actorUserId: null,
    storedSnapshot: JSON.stringify(
      storedQuote({
        expiresAt: "2026-10-01T07:00:00.000Z",
        createdIdempotencyKey: quoteRefreshRequestKey(paymentKey, "fedcba9876543210"),
      }),
    ),
    backgroundRelease: background(),
    allowQuoteRefresh: true,
    quoteRefreshIdempotencyKey: quoteRefreshRequestKey(paymentKey, "fedcba9876543210"),
  });
  ok("reusing the expired quote key creates nothing", replayed.result.code === "GP_QUOTE_EXPIRED" && replayed.calls.length === 0);
}

{
  const changed = await runPayout({
    actorUserId: null,
    storedSnapshot: JSON.stringify(storedQuote({ sourceAmountMinor: 3999, expiresAt: "2026-10-01T07:00:00.000Z" })),
    backgroundRelease: background(),
    allowQuoteRefresh: true,
  });
  ok("changed commercial terms are refused", changed.result.code === "GP_QUOTE_MISMATCH" && changed.calls.length === 0);
}

{
  const blocked = await runPayout({
    actorUserId: null,
    storedSnapshot: JSON.stringify(storedQuote({ expiresAt: "2026-10-01T07:00:00.000Z" })),
    backgroundRelease: background(),
    allowQuoteRefresh: false,
  });
  ok("expired quote without refresh permission is refused", blocked.result.code === "GP_QUOTE_EXPIRED" && blocked.calls.length === 0);
}

function attempt(overrides = {}) {
  return backgroundAttemptDecision({
    hasBackgroundAuthorization: true,
    status: "PENDING",
    failureCode: "",
    failureMessage: "",
    fxRateSnapshot: JSON.stringify(storedQuote({ expiresAt: "2026-10-01T07:00:00.000Z" })),
    stripeOutboundPaymentId: "",
    initiatedAt: null,
    baseIdempotencyKey: paymentKey,
    nowMs: now,
    ...overrides,
  });
}
ok("pre-submission expiry may refresh", attempt().action === "continue" && attempt().allowQuoteRefresh === true);
{
  const inflight = attempt({ stripeOutboundPaymentId: "obp_existing" });
  ok("an existing payment is not refreshed", inflight.action === "stop" && inflight.code === "GP_PAYMENT_IN_FLIGHT");
  ok("an existing payment does not receive a new key", inflight.nextIdempotencyKey == null);
}
{
  const uncertain = attempt({ failureCode: "GP_PAYMENT_OUTCOME_UNCERTAIN", fxRateSnapshot: "" });
  ok("an uncertain outcome stops", uncertain.action === "stop" && uncertain.code === "GP_PAYMENT_OUTCOME_UNCERTAIN");
  ok("an uncertain outcome does not receive a new key", uncertain.nextIdempotencyKey == null);
}
ok(
  "a returned payment is not repaid",
  attempt({ status: "RETURNED", fxRateSnapshot: "" }).code === "GP_RETURNED_MANUAL_REVIEW",
);
ok(
  "a canceled payment is not repaid",
  attempt({ status: "CANCELED", fxRateSnapshot: "" }).code === "GP_FAILED_ATTEMPT_PRESERVED",
);
ok(
  "a definite non-quote failure is not repaid",
  attempt({ status: "FAILED", failureCode: "GP_OUTBOUND_CREATE_FAILED", fxRateSnapshot: "" }).code === "GP_FAILED_ATTEMPT_PRESERVED",
);
{
  const started = planQuoteRefreshIdentity({
    paymentIdempotencyKey: paymentKey,
    stored: storedQuote({ expiresAt: "2026-10-01T07:00:00.000Z" }),
    existingNote: "",
    nextRefreshId: "0123456789abcdef",
    initiatedAt: new Date(now),
    stripeOutboundPaymentId: "",
    failureCode: "",
    status: "PENDING",
  });
  ok("initiatedAt blocks refresh without an outbound payment id", started.action === "stop" && started.code === "GP_PAYMENT_OUTCOME_UNCERTAIN");
}
{
  const first = planQuoteRefreshIdentity({
    paymentIdempotencyKey: paymentKey,
    stored: storedQuote({ expiresAt: "2026-10-01T07:00:00.000Z", quoteId: "obpq_test_example" }),
    existingNote: "",
    nextRefreshId: "0123456789abcdef",
    initiatedAt: null,
    stripeOutboundPaymentId: "",
    failureCode: "",
    status: "PENDING",
  });
  ok("the first refresh claims a new server id", first.action === "claim");
  const claimedNote = JSON.stringify({
    gpQuoteRefresh: { v: 1, id: first.refreshId, replacesQuoteId: "obpq_test_example" },
  });
  const concurrent = planQuoteRefreshIdentity({
    paymentIdempotencyKey: paymentKey,
    stored: storedQuote({ expiresAt: "2026-10-01T07:00:00.000Z", quoteId: "obpq_test_example" }),
    existingNote: claimedNote,
    nextRefreshId: "ffffffffffffffff",
    initiatedAt: null,
    stripeOutboundPaymentId: "",
    failureCode: "",
    status: "PENDING",
  });
  ok("a second worker reuses the claimed refresh key", concurrent.action === "reuse" && concurrent.idempotencyKey === first.idempotencyKey);
  const expiredReplacement = planQuoteRefreshIdentity({
    paymentIdempotencyKey: paymentKey,
    stored: storedQuote({
      expiresAt: "2026-10-01T07:00:00.000Z",
      quoteId: "obpq_test_fresh",
      createdIdempotencyKey: first.idempotencyKey,
    }),
    existingNote: JSON.stringify({
      gpQuoteRefresh: { v: 1, id: first.refreshId, replacesQuoteId: "obpq_test_fresh" },
    }),
    nextRefreshId: "abcdefabcdefabcd",
    initiatedAt: null,
    stripeOutboundPaymentId: "",
    failureCode: "",
    status: "PENDING",
  });
  ok(
    "an expired replacement gets a new server id",
    expiredReplacement.action === "claim" && expiredReplacement.idempotencyKey !== first.idempotencyKey,
  );
}
ok(
  "START_INSPECTION does not release before the recorded deadline",
  recordedInspectionDeadlineAllowsRelease({
    nowMs: now,
    recordedEndsAtIso: "2026-10-01T09:00:00.000Z",
    transactionEndsAtMs: now - 1000,
  }).code === "window_open",
);
ok(
  "a cleared transaction deadline does not count as expiry",
  recordedInspectionDeadlineAllowsRelease({
    nowMs: now,
    recordedEndsAtIso: "2026-10-01T07:00:00.000Z",
    transactionEndsAtMs: null,
  }).code === "window_open",
);
ok(
  "START_INSPECTION releases after both recorded deadlines",
  recordedInspectionDeadlineAllowsRelease({
    nowMs: now,
    recordedEndsAtIso: "2026-10-01T07:00:00.000Z",
    transactionEndsAtMs: now - 1000,
  }).ok === true,
);
{
  const testExpired = attempt({ hasBackgroundAuthorization: false });
  ok("TEST preservation still stops on an expired quote", testExpired.action === "stop" && testExpired.code === "GP_QUOTE_EXPIRED");
  ok("TEST preservation still names the existing corrected key", testExpired.nextIdempotencyKey === correctedQuoteRetryKey(paymentKey));
}

ok("LIVE initiation stays off", isGlobalPayoutsLiveInitiationEnabled() === false);
ok("sandbox initiation stays off", isGlobalPayoutsSandboxEnabled() === false);
ok(
  "reconciliation stays available while initiation is off",
  globalPayoutsReconciliationAllowed({ masterEnabled: true, liveInitiationEnabled: false }) === true,
);
ok("LIVE still requires buyer quote confirmation in the product", gpQuoteConfirmationRequired("LIVE", "STRIPE_GLOBAL_PAYOUTS") === true);
ok("TEST still skips quote confirmation", gpQuoteConfirmationRequired("TEST", "STRIPE_GLOBAL_PAYOUTS") === false);

const outboundSrc = fs.readFileSync(path.join(root, "src/lib/payments/payout-rail/outbound-payment.ts"), "utf8");
const testBranch = outboundSrc.slice(
  outboundSrc.indexOf('if (opts.txnMode === "TEST")'),
  outboundSrc.indexOf('if (opts.txnMode !== "LIVE")'),
);
ok("TEST release branch does not require quote confirmation", !testBranch.includes("evaluateQuoteConfirmation"));
ok("LIVE release still evaluates quote confirmation", outboundSrc.includes("evaluateQuoteConfirmation"));
ok(
  "initiation is still checked before a quoted payout",
  outboundSrc.indexOf("if (!canInitiateGlobalPayoutsMoney") < outboundSrc.indexOf("const payout = await executeQuotedPayout"),
);
const releaseSrc = fs.readFileSync(path.join(root, "src/lib/payments/release.ts"), "utf8");
ok("inspection release still names the authorization failure", releaseSrc.includes("inspection_not_authorized"));
ok("Connect release still has no background authorization flag", releaseSrc.includes("await releaseFinal({ protectedTxnId: fresh.id, actorUserId: null });"));
const cardSrc = fs.readFileSync(path.join(root, "src/components/messaging/PaymentTicketCard.tsx"), "utf8");
ok("the conversation release control is unchanged", cardSrc.includes('submitReceiptDecision("RELEASE_NOW")'));
ok("LIVE quote review is still required in the conversation", cardSrc.includes("quoteConfirmationRequired && !gpQuoteConfirmed"));

console.log(`\n${passed} background authorization checks passed`);
