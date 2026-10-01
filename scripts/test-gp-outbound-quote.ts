/**
 * Mocked cross-border quote sequencing. No Stripe network and no database.
 * Run: node --experimental-strip-types scripts/test-gp-outbound-quote.ts
 */
import assert from "node:assert/strict";
import {
  assessAttemptPreservation,
  correctedAttemptLink,
  correctedQuoteRetryKey,
  evaluateQuoteRoute,
  executeQuotedPayout,
  parseCorrectedAttemptLink,
  parseGpProviderError,
  payoutMethodCurrencies,
  proveNoExistingOutboundPayment,
  quoteIdempotencyKey,
  quoteRequiredForRoute,
  resolveDestinationCurrency,
  runCorrectedQuoteRetry,
  type QuoteHttpResult,
  type QuoteSnapshot,
  type RetryAttemptRecord,
} from "../src/lib/payments/payout-rail/outbound-quote.ts";

let passed = 0;
function ok(name: string, cond: unknown) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`PASS ${name}`);
}

const fa = "fa_test_example";
const recipient = "acct_example";
const method = "thba_test_example";
const now = Date.parse("2026-10-01T08:00:00.000Z");

function quoteBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "obpq_test_example",
    object: "v2.money_management.outbound_payment_quote",
    livemode: false,
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
    ...overrides,
  };
}

function base(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ path: string; idempotencyKey: string; body: Record<string, unknown> }> = [];
  const persisted: QuoteSnapshot[] = [];
  let marked = 0;
  return {
    calls,
    persisted,
    marked: () => marked,
    async run(post: (req: (typeof calls)[number]) => Promise<QuoteHttpResult>) {
      return executeQuotedPayout({
        sourceAmountMinor: 4000,
        sourceCurrency: "GBP",
        destinationCurrency: "thb",
        financialAccountId: fa,
        recipientId: recipient,
        payoutMethodId: method,
        paymentIdempotencyKey: "final_gp_txn_hash",
        metadata: { protectedTxnId: "txn", kind: "FINAL", rail: "STRIPE_GLOBAL_PAYOUTS", termsHash: "abc" },
        mode: "TEST",
        nowMs: now,
        requiresQuote: true,
        storedSnapshot: "",
        post: async (req) => {
          calls.push(req);
          return post(req);
        },
        persistQuote: async (snapshot) => {
          persisted.push(snapshot);
        },
        markPaymentSubmission: async () => {
          marked += 1;
        },
        ...overrides,
      });
    },
  };
}

const currencies = payoutMethodCurrencies({
  bank_account: { country: "TH", supported_currencies: ["thb"] },
});
ok("destination currency comes from the payout method", currencies.length === 1 && currencies[0] === "thb");
ok(
  "country alone does not select a currency",
  resolveDestinationCurrency({ supportedCurrencies: [], mappedCurrency: null }).ok === false,
);
ok(
  "mapped currency is used only when the method supports it",
  resolveDestinationCurrency({ supportedCurrencies: ["thb", "usd"], mappedCurrency: "thb" }).ok === true,
);

{
  const harness = base();
  const result = await harness.run(async (req) => {
    if (req.path.endsWith("outbound_payment_quotes")) {
      ok("quote idempotency key is separate", req.idempotencyKey === quoteIdempotencyKey("final_gp_txn_hash"));
      ok("quote amount stays 4000 GBP", req.body.amount && (req.body.amount as { value: number; currency: string }).value === 4000 && (req.body.amount as { currency: string }).currency === "gbp");
      ok("quote destination currency is THB", (req.body.to as { currency: string }).currency === "thb");
      return { ok: true, status: 200, body: quoteBody(), requestId: "req_quote123" };
    }
    ok("payment is created after the quote is stored", harness.persisted.length === 1 && harness.marked() === 1);
    ok("payment attaches the quote", req.body.outbound_payment_quote === "obpq_test_example");
    ok("payment source amount is still 4000 GBP", (req.body.amount as { value: number; currency: string }).value === 4000 && (req.body.amount as { currency: string }).currency === "gbp");
    ok("payment destination currency is THB", (req.body.to as { currency: string }).currency === "thb");
    ok("payment idempotency key is not the quote key", req.idempotencyKey === "final_gp_txn_hash");
    return { ok: true, status: 200, body: { id: "obp_test_example", status: "processing" }, requestId: "req_pay123" };
  });
  ok("quoted payout succeeds", result.ok === true && result.ok && result.quoteUsed === true);
  ok("persisted quote keeps source and destination amounts apart", harness.persisted[0].sourceAmountMinor === 4000 && harness.persisted[0].sourceCurrency === "gbp" && harness.persisted[0].destinationAmountMinor === 172000 && harness.persisted[0].destinationCurrency === "thb");
}

{
  const harness = base({ destinationCurrency: "gbp", sourceCurrency: "GBP", requiresQuote: false });
  const result = await harness.run(async (req) => {
    ok("domestic same-currency payment omits the quote", req.path.endsWith("outbound_payments") && !("outbound_payment_quote" in req.body));
    ok("domestic same-currency amount stays source currency", (req.body.amount as { currency: string }).currency === "gbp");
    return { ok: true, status: 200, body: { id: "obp_test_same", status: "processing" }, requestId: null };
  });
  ok("domestic same-currency path does not create a quote", result.ok && harness.calls.length === 1 && harness.persisted.length === 0);
}

{
  const policy = quoteRequiredForRoute({ financialAccountCountry: "GB", payoutMethodCountry: "TH" });
  ok("GB to Thailand requires a quote when currencies match", policy.ok === true && policy.ok && policy.required === true);
  const domestic = quoteRequiredForRoute({ financialAccountCountry: "gb", payoutMethodCountry: "GB" });
  ok("same-country route does not require a quote", domestic.ok === true && domestic.ok && domestic.required === false);
  ok(
    "currency difference alone is not the quote rule",
    quoteRequiredForRoute({ financialAccountCountry: "US", payoutMethodCountry: "US" }).ok === true,
  );
  const missing = quoteRequiredForRoute({ financialAccountCountry: "GB", payoutMethodCountry: "" });
  ok("missing country does not skip the quote", missing.ok === false);
  const unread = evaluateQuoteRoute({
    methodReadOk: false,
    financialAccountReadOk: true,
    financialAccountCountry: "GB",
    payoutMethodCountry: "TH",
  });
  ok("payout method read failure prevents payment creation", unread.ok === false && !unread.ok && unread.code === "GP_PAYOUT_METHOD_UNREADABLE");
  const faUnread = evaluateQuoteRoute({
    methodReadOk: true,
    financialAccountReadOk: false,
    financialAccountCountry: "",
    payoutMethodCountry: "TH",
  });
  ok("financial account read failure prevents payment creation", faUnread.ok === false && !faUnread.ok && faUnread.code === "GP_FINANCIAL_ACCOUNT_UNREADABLE");
}

{
  const harness = base({ destinationCurrency: "gbp", sourceCurrency: "GBP", requiresQuote: true });
  const result = await harness.run(async (req) => {
    if (req.path.endsWith("outbound_payment_quotes")) {
      ok("same-currency cross-border quote keeps the source amount", (req.body.amount as { value: number; currency: string }).value === 4000 && (req.body.amount as { currency: string }).currency === "gbp");
      ok("same-currency cross-border quote names the destination currency", (req.body.to as { currency: string }).currency === "gbp");
      return {
        ok: true,
        status: 200,
        requestId: "req_samequote",
        body: quoteBody({
          to: { recipient, payout_method: method, credited: { value: 4000, currency: "gbp" } },
          fx_quote: undefined,
        }),
      };
    }
    ok("same-currency cross-border payment attaches the quote", req.body.outbound_payment_quote === "obpq_test_example");
    ok("same-currency cross-border payment keeps 4000 GBP", (req.body.amount as { value: number; currency: string }).value === 4000 && (req.body.to as { currency: string }).currency === "gbp");
    return { ok: true, status: 200, body: { id: "obp_test_same_border", status: "processing" }, requestId: null };
  });
  ok("same-currency cross-border quote is created before payment", result.ok === true && harness.calls.length === 2);
}

{
  const harness = base();
  const result = await harness.run(async () => ({
    ok: false,
    status: 400,
    requestId: "req_badquote",
    body: {
      error: {
        type: "invalid_request_error",
        code: "outbound_payment_quote_missing",
        param: "outbound_payment_quote",
        message: "Outbound payment quote is required for a COUNTRY_GB cross-border outbound payment.",
      },
    },
  }));
  ok("quote failure does not create a payment", result.ok === false && harness.calls.length === 1 && harness.marked() === 0);
  if (!result.ok && result.parsed) {
    ok("stripe error status is captured", result.parsed.httpStatus === 400);
    ok("stripe error type is captured", result.parsed.type === "invalid_request_error");
    ok("stripe error code is captured", result.parsed.code === "outbound_payment_quote_missing");
    ok("stripe error parameter is captured", result.parsed.param === "outbound_payment_quote");
    ok("stripe request id is captured", result.parsed.requestId === "req_badquote");
    ok("stripe message is redacted text", result.parsed.message.includes("quote is required") && !result.parsed.message.includes("fa_"));
  }
}

{
  const parsed = parseGpProviderError({
    status: 400,
    requestId: "req_not_a_secret",
    body: { error: { message: "refused rk_test_secretvalue and 1234567890123456" } },
  });
  ok("credentials and card numbers are redacted", !parsed.message.includes("rk_test_secretvalue") && !parsed.message.includes("1234567890123456"));
}

{
  const expired = JSON.stringify({
    v: 1,
    quoteId: "obpq_test_old",
    sourceAmountMinor: 4000,
    sourceCurrency: "gbp",
    destinationCurrency: "thb",
    destinationAmountMinor: 172000,
    expiresAt: "2026-10-01T07:00:00.000Z",
    lockStatus: "active",
    rate: "43.0",
    providerFeeMinor: 0,
    crossBorderFeeMinor: 0,
    fxFeeMinor: 0,
  });
  const harness = base({ storedSnapshot: expired });
  const result = await harness.run(async () => {
    throw new Error("must not post");
  });
  ok("expired quote blocks payment creation", result.ok === false && !result.ok && result.code === "GP_QUOTE_EXPIRED" && harness.calls.length === 0);
}

{
  const mismatched = JSON.stringify({
    v: 1,
    quoteId: "obpq_test_old",
    sourceAmountMinor: 100,
    sourceCurrency: "gbp",
    destinationCurrency: "thb",
    destinationAmountMinor: 1,
    expiresAt: "2026-10-01T08:05:00.000Z",
    lockStatus: "active",
    rate: "43.0",
    providerFeeMinor: 0,
    crossBorderFeeMinor: 0,
    fxFeeMinor: 0,
  });
  const harness = base({ storedSnapshot: mismatched });
  const result = await harness.run(async () => {
    throw new Error("must not post");
  });
  ok("mismatched quote blocks payment creation", result.ok === false && !result.ok && result.code === "GP_QUOTE_MISMATCH" && harness.calls.length === 0);
}

{
  const harness = base();
  let posts = 0;
  const result = await harness.run(async (req) => {
    posts += 1;
    if (req.path.endsWith("outbound_payment_quotes")) {
      return { ok: true, status: 200, body: quoteBody(), requestId: null };
    }
    throw new Error("socket hang up");
  });
  ok("ambiguous payment outcome does not post again", result.ok === false && !result.ok && result.uncertain === true && posts === 2);
}

{
  const preserved = assessAttemptPreservation({
    status: "FAILED",
    failureCode: "",
    failureMessage: "Outbound payment quote is required for a COUNTRY_GB cross-border outbound payment.",
    fxRateSnapshot: "",
    stripeOutboundPaymentId: "",
    initiatedAt: null,
    baseIdempotencyKey: "final_gp_txn_hash",
    nowMs: now,
  });
  ok(
    "failed pre-quote attempt keeps its key",
    preserved.preserve === true &&
      preserved.preserve &&
      preserved.nextIdempotencyKey === correctedQuoteRetryKey("final_gp_txn_hash") &&
      preserved.nextIdempotencyKey !== "final_gp_txn_hash",
  );
}

{
  const first = base();
  let paymentBody: Record<string, unknown> | null = null;
  await first.run(async (req) => {
    if (req.path.endsWith("outbound_payment_quotes")) {
      return { ok: true, status: 200, body: quoteBody(), requestId: null };
    }
    paymentBody = structuredClone(req.body);
    return { ok: true, status: 200, body: { id: "obp_test_example", status: "processing" }, requestId: null };
  });
  const second = base({ storedSnapshot: JSON.stringify(first.persisted[0]) });
  const again = await second.run(async (req) => {
    ok("persisted quote does not create another quote", req.path.endsWith("outbound_payments"));
    ok("persisted quote keeps the payment payload stable", JSON.stringify(req.body) === JSON.stringify(paymentBody));
    return { ok: true, status: 200, body: { id: "obp_test_example", status: "processing" }, requestId: null };
  });
  ok("stable replay used the stored quote", again.ok === true && second.calls.length === 1);
}

function originalAttempt(overrides: Partial<RetryAttemptRecord> = {}): RetryAttemptRecord {
  return {
    id: "attempt_original",
    protectedTxnId: "txn_fixture",
    kind: "FINAL",
    idempotencyKey: "final_gp_txn_hash",
    status: "FAILED",
    failureCode: "",
    failureMessage: "Outbound payment quote is required for a COUNTRY_GB cross-border outbound payment.",
    fxRateSnapshot: "",
    stripeOutboundPaymentId: "",
    initiatedAt: null,
    reconciliationNote: "",
    updatedAt: "2026-10-01T08:00:00.000Z",
    amountMinor: 4000,
    currency: "GBP",
    stripeMode: "TEST",
    stripeRecipientId: recipient,
    stripePayoutMethodId: method,
    ...overrides,
  };
}

function retryHarness(seed: RetryAttemptRecord[], proof: { ok: true } | { ok: false; code: "GP_RECONCILIATION_INCOMPLETE" | "GP_PAYMENT_ALREADY_EXISTS" } = { ok: true }) {
  const rows = seed.map((row) => ({ ...row }));
  let posts = 0;
  let sequence = 0;
  return {
    rows,
    posts: () => posts,
    run() {
      return runCorrectedQuoteRetry({
        protectedTxnId: "txn_fixture",
        nowMs: now,
        loadAttempts: async () => rows.map((row) => ({ ...row })),
        createAttempt: async (row) => {
          if (rows.some((existing) => existing.idempotencyKey === row.idempotencyKey)) {
            return { ok: false, code: "UNIQUE" };
          }
          sequence += 1;
          const created: RetryAttemptRecord = {
            ...row,
            id: `attempt_corrected_${sequence}`,
            status: "PENDING",
            failureCode: "",
            failureMessage: "",
            fxRateSnapshot: "",
            stripeOutboundPaymentId: "",
            initiatedAt: null,
            updatedAt: "2026-10-01T08:01:00.000Z",
          };
          rows.push(created);
          return { ok: true, attempt: { ...created } };
        },
        claimAttempt: async (id, updatedAt) => {
          const row = rows.find((item) => item.id === id);
          if (!row || row.updatedAt !== updatedAt || row.failureCode || row.status !== "PENDING" || row.initiatedAt || row.stripeOutboundPaymentId) {
            return false;
          }
          row.failureCode = "GP_RETRY_CLAIMED";
          row.updatedAt = "2026-10-01T08:02:00.000Z";
          return true;
        },
        reconcile: async () => proof,
        execute: async (attempt) => {
          const result = await executeQuotedPayout({
            sourceAmountMinor: attempt.amountMinor,
            sourceCurrency: attempt.currency,
            destinationCurrency: "thb",
            financialAccountId: fa,
            recipientId: attempt.stripeRecipientId,
            payoutMethodId: attempt.stripePayoutMethodId,
            paymentIdempotencyKey: attempt.idempotencyKey,
            metadata: { protectedTxnId: attempt.protectedTxnId, kind: "FINAL", rail: "STRIPE_GLOBAL_PAYOUTS", termsHash: "abc" },
            mode: "TEST",
            nowMs: now,
            requiresQuote: true,
            storedSnapshot: attempt.fxRateSnapshot,
            post: async (req) => {
              posts += 1;
              if (req.path.endsWith("outbound_payment_quotes")) {
                ok("corrected retry quote key is versioned", req.idempotencyKey === quoteIdempotencyKey(correctedQuoteRetryKey("final_gp_txn_hash")));
                return { ok: true, status: 200, body: quoteBody(), requestId: null };
              }
              ok("corrected retry payment key is not the original key", req.idempotencyKey === correctedQuoteRetryKey("final_gp_txn_hash"));
              ok("corrected retry payment attaches the quote", req.body.outbound_payment_quote === "obpq_test_example");
              return { ok: true, status: 200, body: { id: "obp_test_retry", status: "processing" }, requestId: null };
            },
            persistQuote: async (snapshot) => {
              const row = rows.find((item) => item.id === attempt.id);
              if (row) row.fxRateSnapshot = JSON.stringify(snapshot);
            },
            markPaymentSubmission: async () => {
              const row = rows.find((item) => item.id === attempt.id);
              if (row) row.initiatedAt = new Date(now);
            },
          });
          if (!result.ok) throw Object.assign(new Error(result.code), { code: result.code });
          const row = rows.find((item) => item.id === attempt.id);
          if (row) {
            row.status = "PROCESSING";
            row.stripeOutboundPaymentId = "obp_test_retry";
          }
        },
      });
    },
  };
}

{
  const harness = retryHarness([originalAttempt()]);
  const before = JSON.stringify(harness.rows[0]);
  const first = await harness.run();
  ok("corrected retry creates one versioned attempt", first.ok === true && first.ok && first.executed === true && first.created === true);
  ok("corrected retry key is server-derived", harness.rows[1]?.idempotencyKey === correctedQuoteRetryKey("final_gp_txn_hash"));
  ok("corrected retry links to the original attempt", parseCorrectedAttemptLink(harness.rows[1]?.reconciliationNote || "")?.priorAttemptId === "attempt_original");
  ok("corrected retry link matches the helper", harness.rows[1]?.reconciliationNote === correctedAttemptLink("attempt_original"));
  ok("original failed attempt is unchanged", JSON.stringify(harness.rows[0]) === before);
  const second = await harness.run();
  ok("repeated corrected retry finds the same attempt", second.ok === false && !second.ok && second.attemptId === (first.ok ? first.attemptId : "") && second.code === "GP_PAYMENT_IN_FLIGHT");
  ok("repeated corrected retry does not create another payment", harness.posts() === 2 && harness.rows.length === 2);
}

{
  const harness = retryHarness([originalAttempt()]);
  const [left, right] = await Promise.all([harness.run(), harness.run()]);
  const executed = [left, right].filter((result) => result.ok && result.executed);
  const rejected = [left, right].filter((result) => !result.ok && result.code === "GP_RETRY_IN_PROGRESS");
  ok("concurrent corrected retries execute once", executed.length === 1 && rejected.length === 1);
  ok("concurrent corrected retries share one attempt", harness.rows.length === 2 && harness.posts() === 2);
}

{
  const harness = retryHarness([originalAttempt({ failureCode: "GP_PAYMENT_OUTCOME_UNCERTAIN", initiatedAt: new Date(now) })]);
  const result = await harness.run();
  ok("uncertain original outcome prevents another creation", result.ok === false && !result.ok && result.code === "GP_PAYMENT_OUTCOME_UNCERTAIN" && harness.rows.length === 1 && harness.posts() === 0);
}

{
  const existing = proveNoExistingOutboundPayment({
    complete: true,
    payments: [{
      id: "obp_test_existing",
      recipient,
      payoutMethod: method,
      financialAccount: fa,
      amountMinor: 4000,
      currency: "gbp",
      metadataTxnId: "",
    }],
    protectedTxnId: "txn_fixture",
    recipientId: recipient,
    payoutMethodId: method,
    financialAccountId: fa,
    amountMinor: 4000,
    currency: "GBP",
  });
  const harness = retryHarness([originalAttempt()], existing.ok ? { ok: true } : existing);
  const result = await harness.run();
  ok("reconciliation finding a payment prevents the retry", result.ok === false && !result.ok && result.code === "GP_PAYMENT_ALREADY_EXISTS" && harness.rows.length === 1 && harness.posts() === 0);
}

console.log(`\n${passed} passed`);
