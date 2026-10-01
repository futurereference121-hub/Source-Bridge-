/**
 * Mocked cross-border quote sequencing. No Stripe network and no database.
 * Run: node --experimental-strip-types scripts/test-gp-outbound-quote.ts
 */
import assert from "node:assert/strict";
import {
  assessAttemptPreservation,
  correctedQuoteRetryKey,
  executeQuotedPayout,
  parseGpProviderError,
  payoutMethodCurrencies,
  quoteIdempotencyKey,
  resolveDestinationCurrency,
  type QuoteHttpResult,
  type QuoteSnapshot,
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
  const harness = base({ destinationCurrency: "gbp", sourceCurrency: "GBP" });
  const result = await harness.run(async (req) => {
    ok("same-currency payment omits the quote", req.path.endsWith("outbound_payments") && !("outbound_payment_quote" in req.body));
    ok("same-currency amount stays source currency", (req.body.amount as { currency: string }).currency === "gbp");
    return { ok: true, status: 200, body: { id: "obp_test_same", status: "processing" }, requestId: null };
  });
  ok("same-currency path does not create a quote", result.ok && harness.calls.length === 1 && harness.persisted.length === 0);
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

console.log(`\n${passed} passed`);
