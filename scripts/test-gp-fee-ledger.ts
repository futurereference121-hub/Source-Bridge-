/**
 * Mocked fee-ledger evidence. No Stripe network and no database.
 * Run: node --experimental-strip-types scripts/test-gp-fee-ledger.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildFeeLedgerEvidence,
  entryLinkedToPayment,
  platformTestKeyMayListLedger,
  readMonetaryAmount,
  safeProviderError,
  transactionLinkedToPayment,
} from "../src/lib/payments/payout-rail/preview-fee-ledger-report.ts";

let passed = 0;
function ok(name: string, cond: unknown) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`PASS ${name}`);
}

const QUOTE = "obpq_test_sandboxquote";
const PAYMENT = "obp_test_sandboxpayment";
const OTHER = "obp_test_otherpayment";
const TXN = "trxn_test_sandboxpayout";
const FEE_TXN = "trxn_test_sandboxfee";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

ok("integer minor stays integer", readMonetaryAmount({ value: 4000, currency: "gbp" }).value === "4000");
ok("fraction is preserved and not a safe minor", (() => {
  const fee = readMonetaryAmount({ value: 1.5, currency: "gbp" });
  return fee.value === "1.5" && fee.value_type === "decimal_number" && fee.safe_minor == null;
})());
ok("numeric string is preserved", readMonetaryAmount({ value: "150", currency: "gbp" }).value === "150");

const quoteBody = {
  id: QUOTE,
  livemode: false,
  amount: { value: 4000, currency: "gbp" },
  from: { debited: { value: 4000, currency: "gbp" }, financial_account: "fa_test_secret" },
  to: { credited: { value: 177948, currency: "thb" }, payout_method: "thba_test_secret" },
  estimated_fees: [
    { type: "payout_fee", amount: { value: 50, currency: "gbp" } },
    { type: "cross_border_fee", amount: { value: 20, currency: "gbp" } },
    { type: "fx_fee", amount: { value: 1.5, currency: "gbp" } },
  ],
};
const paymentBody = {
  id: PAYMENT,
  livemode: false,
  status: "posted",
  outbound_payment_quote: QUOTE,
  amount: { value: 4000, currency: "gbp" },
  from: { debited: { value: 4000, currency: "gbp" } },
  to: { credited: { value: 177948, currency: "thb" } },
  receipt_url: "https://payments.stripe.com/secret",
};

ok("same amount without the payment flow is not linked", !transactionLinkedToPayment({
  id: FEE_TXN,
  category: "stripe_fee",
  amount: { value: -150, currency: "gbp" },
  flow: { type: "fee_transaction", fee_transaction: "ft_unrelated" },
}, PAYMENT));
ok("flow.outbound_payment links the payout", transactionLinkedToPayment({
  id: TXN,
  category: "outbound_payment",
  flow: { type: "outbound_payment", outbound_payment: PAYMENT },
}, PAYMENT));
ok("another payment id does not link", !transactionLinkedToPayment({
  id: TXN,
  flow: { type: "outbound_payment", outbound_payment: OTHER },
}, PAYMENT));
ok("entry follows its transaction id", entryLinkedToPayment({
  id: "trxne_test_entry",
  transaction: TXN,
  transaction_details: { category: "outbound_payment", flow: { type: "outbound_payment" } },
}, PAYMENT, TXN));

const report = buildFeeLedgerEvidence({
  hostH8: "bf232aa9",
  initiationIsFalse: true,
  deploymentCommit: "73cc262b5169",
  fixtureOk: true,
  blocker: null,
  quoteId: QUOTE,
  paymentId: PAYMENT,
  quoteOk: true,
  quoteLivemode: false,
  quoteBody,
  paymentOk: true,
  paymentLivemode: false,
  paymentBody,
  transactionList: {
    queried: true,
    filter: "financial_account_and_flow",
    httpOk: true,
    complete: true,
    pages: 1,
    error: null,
    rejected_filters: [],
    rows: [
      {
        id: TXN,
        category: "outbound_payment",
        status: "posted",
        livemode: false,
        amount: { value: -4000, currency: "gbp" },
        balance_impact: { available: { value: -4000, currency: "gbp" } },
        flow: { type: "outbound_payment", outbound_payment: PAYMENT },
      },
      {
        id: FEE_TXN,
        category: "stripe_fee",
        status: "posted",
        livemode: false,
        amount: { value: -150, currency: "gbp" },
        balance_impact: { available: { value: -150, currency: "gbp" } },
        flow: { type: "fee_transaction", fee_transaction: "ft_unrelated" },
      },
    ],
  },
  entryList: {
    queried: true,
    httpOk: true,
    complete: true,
    pages: 1,
    groups: [{
      transactionId: TXN,
      rows: [{
        id: "trxne_test_entry",
        transaction: TXN,
        balance_impact: { available: { value: -4000, currency: "gbp" } },
        transaction_details: {
          category: "outbound_payment",
          flow: { type: "outbound_payment", outbound_payment: PAYMENT },
        },
      }],
    }],
  },
}) as {
  quote: { estimated_fees: Array<{ value: string; value_type: string }>; debited: { value: string } };
  transactions: { matched_count: number; unlinked_filter_rows: number };
  comparison: {
    debit_equals_presentment: boolean;
    fees_included_inferred_from_equality: boolean;
    actual_fees_versus_estimates: string;
    same_currency_estimated_fee_safe_minor_sum: number | null;
  };
  mutations: { stripe_writes: number; db_writes: number };
};

ok("fractional fee is reported", report.quote.estimated_fees[2].value === "1.5");
ok("debit fact is separate from inclusion", report.comparison.debit_equals_presentment === true && report.comparison.fees_included_inferred_from_equality === false);
ok("fractional fee sum is not coerced", report.comparison.same_currency_estimated_fee_safe_minor_sum == null);
ok("unlinked fee is not counted", report.transactions.matched_count === 1 && report.transactions.unlinked_filter_rows === 1);
ok("absent linked fee is not called equal", report.comparison.actual_fees_versus_estimates === "no_linked_fee_transactions");
ok("report hides full ids and receipt", !JSON.stringify(report).includes("fa_test_secret") && !JSON.stringify(report).includes("receipt"));
ok("report writes nothing", report.mutations.stripe_writes === 0 && report.mutations.db_writes === 0);

const truncated = buildFeeLedgerEvidence({
  hostH8: "bf232aa9",
  initiationIsFalse: true,
  deploymentCommit: "73cc262b5169",
  fixtureOk: true,
  blocker: "transaction_list_incomplete",
  quoteId: QUOTE,
  paymentId: PAYMENT,
  quoteOk: true,
  quoteLivemode: false,
  quoteBody,
  paymentOk: true,
  paymentLivemode: false,
  paymentBody,
  transactionList: {
    queried: true,
    filter: "both",
    httpOk: false,
    complete: false,
    pages: 1,
    rows: [],
    error: { http_status: 400, code: "invalid_filters", type: "invalid_request_error" },
    rejected_filters: [],
  },
  entryList: { queried: true, httpOk: true, complete: false, pages: 0, groups: [] },
}) as { ok: boolean; comparison: { actual_fees_versus_estimates: string } };
ok("incomplete discovery is not a zero-fee result", !truncated.ok && truncated.comparison.actual_fees_versus_estimates === "incomplete");

const route = source("../src/app/api/diagnostics/gp-preview-runtime/fee-ledger/route.ts");
const retrieval = source("../src/lib/payments/payout-rail/preview-fee-ledger.ts");
const e2e = source("../src/app/api/diagnostics/gp-preview-runtime/e2e/route.ts");
const restore = source("../src/app/api/diagnostics/gp-preview-runtime/restore/route.ts");
ok("fee route is GET only", route.includes("export async function GET") && !route.includes("export async function POST"));
ok("retrieval is TEST GET only", retrieval.includes('mode: "TEST"') && retrieval.includes('method: "GET"') && !retrieval.includes('method: "POST"'));
ok("retrieval matches by flow id", retrieval.includes("transactionLinkedToPayment"));
ok("mutation routes stay disabled", e2e.includes("status: 410") && restore.includes("status: 410"));
const hidden = safeProviderError(403, {
  error: { code: "more_permissions_required", type: "invalid_request_error", message: "obp_test_secret_should_not_appear" },
});
ok("provider error keeps only the safe code", hidden.code === "more_permissions_required" && hidden.http_status === 403);
ok("provider error drops the message", !JSON.stringify(hidden).includes("obp_test_secret"));
ok(
  "platform key is used only after the same financial account is retrieved",
  platformTestKeyMayListLedger({
    restrictedHttpStatus: 403,
    restrictedCode: "forbidden",
    keyPrefixOk: true,
    retrievedIdMatches: true,
    livemodeFalse: true,
  }) === true,
);
ok(
  "platform key is not used when the account proof fails",
  platformTestKeyMayListLedger({
    restrictedHttpStatus: 403,
    restrictedCode: "forbidden",
    keyPrefixOk: true,
    retrievedIdMatches: false,
    livemodeFalse: true,
  }) === false,
);
ok("retrieval names one proven platform key", retrieval.includes("STRIPE_SECRET_KEY_TEST") && retrieval.includes("platformTestKeyMayListLedger"));
ok("entry reads use the same proven key", retrieval.includes('credential === "platform_test_secret_proven" ? platformTestGet'));
ok("retrieval does not scan live keys", !retrieval.includes("sk_live_") && !retrieval.includes("rk_live_"));

console.log(`\n${passed} passed`);
