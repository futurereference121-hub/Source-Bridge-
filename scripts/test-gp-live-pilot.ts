/**
 * Mocked Global Payouts pilot controls. No Stripe network and no database.
 * Run: node --experimental-strip-types scripts/test-gp-live-pilot.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  evaluateLivePilotInitiation,
  evaluatePilotOccupancy,
  evaluateQuoteConfirmation,
  globalPayoutsReconciliationAllowed,
  liveUserAllowed,
  PILOT_CAP_COVERS,
  planQuotePreparation,
  pilotAppliesToRail,
} from "../src/lib/payments/payout-rail/live-pilot.ts";
import {
  executeQuotedPayout,
  prepareQuoteOnly,
  type QuoteHttpResult,
} from "../src/lib/payments/payout-rail/outbound-quote.ts";
import {
  deriveOutboundDisplayState,
  GP_POSTED_WORDING,
} from "../src/lib/payments/payout-rail/outbound-display.ts";
import {
  decideOutboundEventTransition,
  isUnderReviewOutboundEvent,
  mapOutboundPaymentProviderStatus,
  mapThinOutboundEventType,
  outboundPaymentIsUnderReview,
  underReviewBlocksFinalization,
} from "../src/lib/payments/payout-rail/status-mapper.ts";

let passed = 0;
function ok(name: string, cond: unknown) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`PASS ${name}`);
}

const seller = "seller_user_1";
const buyer = "buyer_user_1";
const txn = "txn_pilot_1";
const otherTxn = "txn_pilot_2";

function live(overrides: Record<string, unknown> = {}) {
  return evaluateLivePilotInitiation({
    mode: "LIVE",
    gpEnabled: true,
    userAllowlistRaw: seller,
    userId: seller,
    email: "seller@example.com",
    countryAllowed: true,
    actorUserId: buyer,
    buyerId: buyer,
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

ok("TEST empty allowlist stays explicit open ramp", liveUserAllowed({
  enabled: true,
  mode: "TEST",
  allowlistRaw: "",
  userId: seller,
}) === true);
ok("LIVE empty allowlist denies", liveUserAllowed({
  enabled: true,
  mode: "LIVE",
  allowlistRaw: "",
  userId: seller,
}) === false);
ok("LIVE wildcard allowlist denies", liveUserAllowed({
  enabled: true,
  mode: "LIVE",
  allowlistRaw: "*",
  userId: seller,
}) === false);
ok("LIVE invalid entry denies the whole list", liveUserAllowed({
  enabled: true,
  mode: "LIVE",
  allowlistRaw: `${seller},*`,
  userId: seller,
}) === false);
ok("LIVE listed user is allowed", liveUserAllowed({
  enabled: true,
  mode: "LIVE",
  allowlistRaw: seller,
  userId: seller,
}) === true);
ok("LIVE unlisted user is denied", liveUserAllowed({
  enabled: true,
  mode: "LIVE",
  allowlistRaw: "someone_else_1",
  userId: seller,
}) === false);

const deniedCases: Array<[string, Record<string, unknown>, string]> = [
  ["empty cap", { amountCapRaw: "" }, "GP_PILOT_AMOUNT_CAP_INVALID"],
  ["invalid cap", { amountCapRaw: "0" }, "GP_PILOT_AMOUNT_CAP_INVALID"],
  ["missing currency", { configuredSourceCurrencyRaw: "" }, "GP_PILOT_SOURCE_CURRENCY_INVALID"],
  ["currency mismatch", { sourceCurrency: "USD" }, "GP_PILOT_SOURCE_CURRENCY_INVALID"],
  ["principal over cap", { principalMinor: 3000, providerFeeMinor: 0, crossBorderFeeMinor: 0, fxFeeMinor: 0 }, "GP_PILOT_AMOUNT_CAP_EXCEEDED"],
  ["balance below principal", { availableBalanceMinor: 1999 }, "GP_PILOT_FUNDING_SHORT"],
  ["unreadable balance", { availableBalanceMinor: null }, "GP_PILOT_FUNDING_UNVERIFIED"],
  ["other transaction", { transactionId: otherTxn }, "GP_PILOT_TRANSACTION_NOT_AUTHORIZED"],
  ["unauthorized actor", { actorUserId: seller }, "GP_PILOT_ACTOR_UNAUTHORIZED"],
  ["country denied", { countryAllowed: false }, "GP_PILOT_COUNTRY_NOT_ALLOWLISTED"],
  ["destination below minimum", { destinationAmountMinor: 1000 }, "GP_PILOT_DESTINATION_MINIMUM"],
  ["invalid destination minimums", { destinationMinimumsRaw: "THB:nope" }, "GP_PILOT_DESTINATION_MINIMUMS_INVALID"],
  ["fee currency unresolved", { fxFeeCurrency: "" }, "GP_PILOT_FEE_CURRENCY_UNRESOLVED"],
];
for (const [name, overrides, code] of deniedCases) {
  const result = live(overrides);
  ok(`${name} denies initiation`, !result.ok && result.code === code);
}

const allowed = live();
ok(
  "cap and balance cover principal plus separate source fees once",
  allowed.ok &&
    allowed.capCovers === PILOT_CAP_COVERS &&
    allowed.providerFeeTotalMinor === 150 &&
    allowed.totalSourceDebitMinor === 2000 + 150,
);
ok(
  "balance that covers only the principal is short",
  live({ availableBalanceMinor: 2000 }).ok === false &&
    live({ availableBalanceMinor: 2000 }).code === "GP_PILOT_FUNDING_SHORT",
);
ok(
  "separate fees push the cover over the cap",
  live({ principalMinor: 2400, availableBalanceMinor: 3000 }).ok === false &&
    live({ principalMinor: 2400, availableBalanceMinor: 3000 }).code === "GP_PILOT_AMOUNT_CAP_EXCEEDED",
);
ok(
  "zero separate fees leave the cover equal to principal",
  live({
    principalMinor: 2400,
    availableBalanceMinor: 2400,
    providerFeeMinor: 0,
    crossBorderFeeMinor: 0,
    fxFeeMinor: 0,
  }).ok === true,
);
ok("TEST initiation does not apply the live cap", evaluateLivePilotInitiation({
  ...live(),
  mode: "TEST",
  amountCapRaw: "",
  userAllowlistRaw: "",
}).ok === true);
ok("Connect rail is outside the pilot", pilotAppliesToRail("STRIPE_CONNECT") === false);
ok("Global Payouts rail is inside the pilot", pilotAppliesToRail("STRIPE_GLOBAL_PAYOUTS") === true);

const first = evaluatePilotOccupancy({
  authorizedTransactionId: txn,
  requestedTransactionId: txn,
  claimingAttemptId: "attempt_a",
  attempts: [],
});
ok("first authorized claim is open", first.ok === true);
const second = evaluatePilotOccupancy({
  authorizedTransactionId: txn,
  requestedTransactionId: txn,
  claimingAttemptId: "attempt_b",
  attempts: [{
    id: "attempt_a",
    transactionId: txn,
    outboundPaymentId: "",
    status: "PENDING",
    failureCode: "GP_PILOT_SLOT",
  }],
});
ok("concurrent second claim is denied", !second.ok && second.code === "GP_PILOT_PAYMENT_ALREADY_STARTED");
const other = evaluatePilotOccupancy({
  authorizedTransactionId: txn,
  requestedTransactionId: otherTxn,
  claimingAttemptId: "attempt_c",
  attempts: [],
});
ok("unauthorized transaction cannot start", !other.ok && other.code === "GP_PILOT_TRANSACTION_NOT_AUTHORIZED");
const reviewBlock = evaluatePilotOccupancy({
  authorizedTransactionId: txn,
  requestedTransactionId: txn,
  claimingAttemptId: "attempt_new",
  attempts: [{
    id: "attempt_review",
    transactionId: txn,
    outboundPaymentId: "obp_test_held",
    status: "PROCESSING",
    failureCode: "GP_UNDER_REVIEW",
  }],
});
ok("under review blocks another payout", !reviewBlock.ok && reviewBlock.code === "GP_PILOT_PAYMENT_ALREADY_STARTED");
const sameAfterClaim = evaluatePilotOccupancy({
  authorizedTransactionId: txn,
  requestedTransactionId: txn,
  claimingAttemptId: "attempt_a",
  attempts: [{
    id: "attempt_a",
    transactionId: txn,
    outboundPaymentId: "",
    status: "PENDING",
    failureCode: "GP_PILOT_SLOT",
  }],
});
ok("durable claim blocks the same attempt after the lock ends", !sameAfterClaim.ok && sameAfterClaim.code === "GP_PILOT_PAYMENT_ALREADY_STARTED");
const uncertainSlot = evaluatePilotOccupancy({
  authorizedTransactionId: txn,
  requestedTransactionId: txn,
  claimingAttemptId: "attempt_new",
  attempts: [{
    id: "attempt_old",
    transactionId: txn,
    outboundPaymentId: "",
    status: "FAILED",
    failureCode: "GP_PAYMENT_OUTCOME_UNCERTAIN",
    initiatedAt: "2026-10-02T00:00:00.000Z",
  }],
});
ok("uncertain outcome keeps the payment slot", !uncertainSlot.ok && uncertainSlot.code === "GP_PILOT_PAYMENT_ALREADY_STARTED");

ok("quote preparation never selects a payment path", planQuotePreparation({
  mode: "LIVE",
  initiationEnabled: true,
  requiresQuote: true,
}).paymentPath === false);
ok("initiation off blocks preparation and leaves reconciliation available",
  !planQuotePreparation({ mode: "LIVE", initiationEnabled: false, requiresQuote: true }).ok &&
  globalPayoutsReconciliationAllowed({ masterEnabled: true, liveInitiationEnabled: false }) === true);
ok("master off stops reconciliation", globalPayoutsReconciliationAllowed({
  masterEnabled: false,
  liveInitiationEnabled: false,
}) === false);

const calls: string[] = [];
const prepared = await prepareQuoteOnly({
  sourceAmountMinor: 2000,
  sourceCurrency: "gbp",
  destinationCurrency: "thb",
  financialAccountId: "fa_test_example",
  recipientId: "acct_example",
  payoutMethodId: "thba_test_example",
  quoteIdempotencyKey: "quote_key",
  mode: "TEST",
  nowMs: Date.parse("2026-10-01T08:00:00.000Z"),
  post: async (req) => {
    calls.push(req.path);
    const body: QuoteHttpResult = {
      ok: true,
      status: 200,
      requestId: null,
      body: {
        id: "obpq_test_prepared",
        livemode: false,
        amount: { value: 2000, currency: "gbp" },
        from: { financial_account: "fa_test_example", debited: { value: 2000, currency: "gbp" } },
        to: { recipient: "acct_example", payout_method: "thba_test_example", credited: { value: 90000, currency: "thb" } },
        fx_quote: {
          lock_status: "active",
          lock_expires_at: "2026-10-01T08:05:00.000Z",
          to_currency: "thb",
          rates: { gbp: { exchange_rate: "45" } },
        },
        estimated_fees: [
          { type: "standard_payout_fee", amount: { value: 50, currency: "gbp" } },
        ],
      },
    };
    return body;
  },
});
ok("quote preparation posts only the quote", prepared.ok && calls.length === 1 && calls[0].endsWith("outbound_payment_quotes"));

function stored(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    v: 1,
    quoteId: "obpq_test_reviewed",
    sourceAmountMinor: 4000,
    sourceCurrency: "gbp",
    destinationCurrency: "thb",
    destinationAmountMinor: 172000,
    expiresAt: "2026-10-01T08:05:00.000Z",
    lockStatus: "active",
    rate: "43",
    providerFeeMinor: 50,
    crossBorderFeeMinor: 20,
    fxFeeMinor: 80,
    providerFeeCurrency: "gbp",
    crossBorderFeeCurrency: "gbp",
    fxFeeCurrency: "gbp",
    confirmedByUserId: buyer,
    transactionId: "txn",
    recipientId: "acct_example",
    payoutMethodId: "thba_test_example",
    mode: "LIVE",
    termsHash: "abc",
    feePayer: "Source Bridge",
    ...overrides,
  });
}

async function release(snapshot: string, actor = buyer) {
  const seen: Array<{ path: string; body: Record<string, unknown> }> = [];
  const result = await executeQuotedPayout({
    sourceAmountMinor: 4000,
    sourceCurrency: "GBP",
    destinationCurrency: "thb",
    financialAccountId: "fa_test_example",
    recipientId: "acct_example",
    payoutMethodId: "thba_test_example",
    paymentIdempotencyKey: "final_gp_txn_hash",
    metadata: { protectedTxnId: "txn", kind: "FINAL", rail: "STRIPE_GLOBAL_PAYOUTS", termsHash: "abc" },
    mode: "LIVE",
    nowMs: Date.parse("2026-10-01T08:00:00.000Z"),
    requiresQuote: true,
    storedSnapshot: snapshot,
    actorUserId: actor,
    post: async (req) => {
      seen.push(req);
      return { ok: true, status: 200, requestId: null, body: { id: "obp_test_once", status: "processing" } };
    },
    persistQuote: async () => {
      throw new Error("confirmation must not create a replacement quote");
    },
    markPaymentSubmission: async () => undefined,
  });
  return { result, seen };
}

const missing = await release("");
ok("live release without a reviewed quote makes no payment", !missing.result.ok && missing.seen.length === 0);
const unauthorized = await release(stored(), "other_user_1");
ok("unauthorized confirmation is rejected", !unauthorized.result.ok && unauthorized.result.code === "GP_QUOTE_ACTOR_MISMATCH" && unauthorized.seen.length === 0);
const altered = await release(stored({ sourceAmountMinor: 100 }));
ok("altered quote is rejected", !altered.result.ok && altered.result.code === "GP_QUOTE_MISMATCH" && altered.seen.length === 0);
const expired = await release(stored({ expiresAt: "2026-10-01T07:00:00.000Z" }));
ok("expired quote is rejected", !expired.result.ok && expired.result.code === "GP_QUOTE_EXPIRED" && expired.seen.length === 0);
const accepted = await release(stored());
ok(
  "valid confirmation submits once with the reviewed quote",
  accepted.result.ok &&
    accepted.seen.length === 1 &&
    accepted.seen[0].path.endsWith("outbound_payments") &&
    accepted.seen[0].body.outbound_payment_quote === "obpq_test_reviewed",
);
const bound = evaluateQuoteConfirmation({
  stored: JSON.parse(stored()),
  actorUserId: buyer,
  transactionId: "txn",
  mode: "LIVE",
  recipientId: "acct_example",
  payoutMethodId: "thba_test_example",
  sourceAmountMinor: 4000,
  sourceCurrency: "gbp",
  destinationCurrency: "thb",
  termsHash: "abc",
  nowMs: Date.parse("2026-10-01T08:00:00.000Z"),
});
ok("confirmation is bound to the stored quote id", bound.ok && bound.quoteId === "obpq_test_reviewed");

const held = {
  status: "processing",
  status_details: { processing: { reason: "under_review" } },
};
ok("under_review stays processing", mapOutboundPaymentProviderStatus(held) === "PROCESSING");
ok("under_review is recognized on the object and event", outboundPaymentIsUnderReview(held) && isUnderReviewOutboundEvent("v2.money_management.outbound_payment.under_review"));
ok("under_review blocks finalization", underReviewBlocksFinalization({ providerUnderReview: true }));
ok("posted after review can still map to success", mapThinOutboundEventType("v2.money_management.outbound_payment.posted") === "SUCCEEDED");
ok("review failure reasons stay failed outcomes", mapThinOutboundEventType("v2.money_management.outbound_payment.failed") === "FAILED");
const reviewEvent = "v2.money_management.outbound_payment.under_review";
const postedEvent = "v2.money_management.outbound_payment.posted";
const returnedEvent = "v2.money_management.outbound_payment.returned";
const processingEvent = "v2.money_management.outbound_payment.created";
const heldDecision = decideOutboundEventTransition({
  currentStatus: "PENDING",
  failureCode: "",
  eventType: reviewEvent,
});
ok("under_review event holds processing and does not finalize", heldDecision.status === "PROCESSING" && heldDecision.failureCode === "GP_UNDER_REVIEW" && heldDecision.finalize === false);
const duplicateReview = decideOutboundEventTransition({
  currentStatus: "PROCESSING",
  failureCode: "GP_UNDER_REVIEW",
  eventType: reviewEvent,
});
ok("duplicate under_review does not finalize", duplicateReview.finalize === false && duplicateReview.failureCode === "GP_UNDER_REVIEW");
const postedAfterReview = decideOutboundEventTransition({
  currentStatus: "PROCESSING",
  failureCode: "GP_UNDER_REVIEW",
  eventType: postedEvent,
  providerUnderReview: false,
});
ok("posted after review can finalize", postedAfterReview.finalize === true && postedAfterReview.status === "SUCCEEDED");
const reviewAfterPosted = decideOutboundEventTransition({
  currentStatus: "SUCCEEDED",
  failureCode: "",
  eventType: reviewEvent,
});
ok("late under_review does not regress posted", reviewAfterPosted.changed === false && reviewAfterPosted.finalize === false && reviewAfterPosted.status === "SUCCEEDED");
const returnedAfterPosted = decideOutboundEventTransition({
  currentStatus: "SUCCEEDED",
  failureCode: "",
  eventType: returnedEvent,
});
ok("returned after posted is recorded", returnedAfterPosted.status === "RETURNED" && returnedAfterPosted.finalize === false);
const postedAfterReturned = decideOutboundEventTransition({
  currentStatus: "RETURNED",
  failureCode: "RETURNED",
  eventType: postedEvent,
});
ok("late posted does not regress returned", postedAfterReturned.changed === false && postedAfterReturned.finalize === false && postedAfterReturned.status === "RETURNED");
const processingDuringReview = decideOutboundEventTransition({
  currentStatus: "PROCESSING",
  failureCode: "GP_UNDER_REVIEW",
  eventType: processingEvent,
});
ok("ordinary processing event keeps the review hold", processingDuringReview.failureCode === "GP_UNDER_REVIEW" && processingDuringReview.finalize === false);
const retrievedShape = {
  status: "processing",
  status_details: { processing: { reason: "under_review" } },
};
ok("retrieved 2026-08-26 processing object stays under review", outboundPaymentIsUnderReview(retrievedShape) && mapOutboundPaymentProviderStatus(retrievedShape) === "PROCESSING");
const reviewDisplay = deriveOutboundDisplayState("PROCESSING", "GP_UNDER_REVIEW");
ok("under_review display is pending", reviewDisplay.pendingProvider === true && reviewDisplay.phase === "manual_review");
const postedDisplay = deriveOutboundDisplayState("SUCCEEDED");
ok("posted wording does not claim bank receipt", postedDisplay.adminLabel === GP_POSTED_WORDING && GP_POSTED_WORDING.includes("financial account"));

const root = new URL("../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), "utf8");
const pilotSource = read("src/lib/payments/payout-rail/live-pilot.ts");
ok("cap is not hardcoded", !/\b1000\b/.test(pilotSource));
const quoteReview = read("src/lib/payments/payout-rail/quote-review.ts");
ok("quote review does not post an outbound payment", !quoteReview.includes("OUTBOUND_PAYMENT_PATH"));
ok("confirmation does not rewrite stored terms before checking them", quoteReview.includes("confirmedByUserId: opts.actorUserId") && !quoteReview.includes("termsHash: txn.termsHash,\n      feePayer"));
const claimSource = read("src/lib/payments/payout-rail/outbound-payment.ts");
const claimStart = claimSource.indexOf("async function claimLivePilotSlot");
const claimEnd = claimSource.indexOf("async function executeOutboundRelease");
const claimBody = claimSource.slice(claimStart, claimEnd);
ok("pilot lock and claim share one transaction client", claimBody.includes("tx.$executeRaw") && claimBody.includes("tx.outboundPaymentAttempt.updateMany") && !claimBody.includes("prisma.outboundPaymentAttempt"));
ok(
  "uncertain retry does not clear the claim",
  claimSource.includes("pilotFailureIsSticky(existingAttempt.failureCode)") &&
    claimSource.includes("Automatic retry is blocked"),
);
const events = read("src/lib/payments/payout-rail/events.ts");
ok("reconciliation does not depend on live initiation being on", events.includes("globalPayoutsReconciliationAllowed("));
ok("under_review uses the existing reconciliation handler", events.includes("isUnderReviewOutboundEvent(") && events.includes("finalizeOutboundSuccess("));
const diagnostics = read("src/app/api/diagnostics/gp-preview-runtime/e2e/route.ts");
ok("diagnostic payout route stays disabled", diagnostics.includes("status: 410") && diagnostics.includes("disabledDiagnosticMutation("));
const flags = read("src/lib/payments/flags.ts");
ok("live initiation default stays false", flags.includes('envBool("GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED", false)'));
const releaseSource = read("src/lib/payments/release.ts");
ok("Connect release remains a separate path", releaseSource.includes("lockedPayoutRailFromTxn(txn) === \"STRIPE_GLOBAL_PAYOUTS\""));

console.log(`\n${passed} passed`);
