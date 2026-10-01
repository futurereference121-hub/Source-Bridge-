/**
 * Mocked reporting for the Sandbox payment verification. No Stripe and no database.
 * Run: node --experimental-strip-types scripts/test-gp-sandbox-verify.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildSandboxPaymentVerification,
  redactedId,
  stripeTerminalCompletion,
  type ListedOutbound,
  type VerifyAttemptInput,
} from "../src/lib/payments/payout-rail/preview-sandbox-verify-report.ts";

let passed = 0;
function ok(name: string, cond: unknown) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`PASS ${name}`);
}

const TXN = "txn_sandbox_fixture";
const ORIGINAL = "attempt_original_failed";
const CORRECTED = "attempt_corrected_quote";
const PAYMENT = "obp_test_sandboxpayment";
const QUOTE = "obpq_test_sandboxquote";
const OTHER_PAYMENT = "obp_test_otherpayment";
const RECIPIENT = "acct_sandbox_recipient";
const METHOD = "thba_test_sandboxmethod";
const FA = "fa_test_sandboxaccount";

function attempt(partial: Partial<VerifyAttemptInput> & Pick<VerifyAttemptInput, "id" | "status" | "idempotencyKey">): VerifyAttemptInput {
  return {
    stripeOutboundPaymentId: "",
    fxRateSnapshot: "",
    amountMinor: 4000,
    currency: "gbp",
    destinationCurrency: "thb",
    destinationAmountMinor: 170000,
    providerFeeMinor: 100,
    crossBorderFeeMinor: 50,
    fxFeeMinor: 25,
    stripeRecipientId: RECIPIENT,
    stripePayoutMethodId: METHOD,
    stripeMode: "TEST",
    ...partial,
  };
}

function listed(id: string, metadataTxnId = ""): ListedOutbound {
  return {
    id,
    recipient: RECIPIENT,
    payoutMethod: METHOD,
    financialAccount: FA,
    amountMinor: 4000,
    currency: "gbp",
    metadataTxnId,
    status: "processing",
    livemode: false,
  };
}

const quoteSnapshot = JSON.stringify({
  v: 1,
  quoteId: QUOTE,
  sourceAmountMinor: 4000,
  sourceCurrency: "gbp",
  destinationCurrency: "thb",
  destinationAmountMinor: 170000,
  providerFeeMinor: 100,
  crossBorderFeeMinor: 50,
  fxFeeMinor: 25,
});

function report(overrides: Record<string, unknown> = {}) {
  const corrected = attempt({
    id: CORRECTED,
    status: "SUCCEEDED",
    idempotencyKey: "final_gp_txn_quote_v1",
    stripeOutboundPaymentId: PAYMENT,
    fxRateSnapshot: quoteSnapshot,
  });
  const base = {
    hostH8: "bf232aa9",
    initiationIsFalse: true,
    deploymentCommit: "47d4c27c089e",
    txn: {
      id: TXN,
      status: "RELEASED",
      stripeMode: "TEST",
      currency: "GBP",
      itemCostMinor: 4000,
      sellerGpRecipientId: RECIPIENT,
      sellerGpPayoutMethodId: METHOD,
    },
    attempts: [
      attempt({ id: ORIGINAL, status: "FAILED", idempotencyKey: "final_gp_txn" }),
      corrected,
    ],
    financialAccountId: FA,
    listComplete: true,
    listed: [listed(PAYMENT, TXN)],
    retrieved: {
      ok: true,
      id: PAYMENT,
      status: "processing",
      livemode: false,
      recipient: RECIPIENT,
      payoutMethod: METHOD,
      metadataTxnId: TXN,
    },
    quote: {
      attempted: true,
      ok: true,
      id: QUOTE,
      sourceAmountMinor: 4000,
      sourceCurrency: "gbp",
      destinationAmountMinor: 170000,
      destinationCurrency: "thb",
    },
    connectTransferCount: 0,
  };
  return buildSandboxPaymentVerification({ ...base, ...overrides });
}

const pending = report();
ok("two attempt rows are not duplicate payments", pending.duplicate_discovery && (pending.duplicate_discovery as { duplicate_payments: boolean }).duplicate_payments === false);
ok("one stored payment counts once", (pending.duplicate_discovery as { distinct_matching_payment_count: number }).distinct_matching_payment_count === 1);
ok("attempt rows are labeled separately from payments", (pending.duplicate_discovery as { attempt_rows_are_not_payments: boolean }).attempt_rows_are_not_payments === true);
ok("processing Stripe status is not terminal", pending.terminal_completion === "pending");
ok("application success is not bank completion", (pending as { application_released: boolean }).application_released === true && pending.terminal_completion !== "confirmed");
ok("succeeded application with processing Stripe is a mismatch", pending.application_stripe_mismatch === "application_succeeded_stripe_not_terminal");
ok("corrected attempt is selected", (pending.attempts as { role: string; status: string; corrected_retry: boolean }[]).some((row) => row.role === "corrected" && row.status === "SUCCEEDED" && row.corrected_retry));
ok("failed attempt is not treated as the corrected payment", (pending.attempts as { status: string; corrected_retry: boolean; outbound_present: boolean }[]).some((row) => row.status === "FAILED" && row.corrected_retry === false && row.outbound_present === false));

const posted = report({
  retrieved: {
    ok: true,
    id: PAYMENT,
    status: "posted",
    livemode: false,
    recipient: RECIPIENT,
    payoutMethod: METHOD,
    metadataTxnId: TXN,
  },
});
ok("posted Stripe status confirms terminal completion", posted.terminal_completion === "confirmed");
ok("posted Stripe status matches a succeeded attempt", posted.application_stripe_mismatch === null);

const duplicate = report({
  listed: [listed(PAYMENT, TXN), listed(OTHER_PAYMENT, TXN)],
});
ok("two Stripe payments are duplicates", (duplicate.duplicate_discovery as { distinct_matching_payment_count: number; duplicate_payments: boolean }).distinct_matching_payment_count === 2);
ok("duplicate flag follows Stripe ids", (duplicate.duplicate_discovery as { duplicate_payments: boolean }).duplicate_payments === true);

const incomplete = report({ listComplete: false, listed: [listed(PAYMENT, TXN)] });
ok("incomplete discovery is not proof of uniqueness", (incomplete.duplicate_discovery as { complete: boolean; duplicate_payments: boolean | null }).complete === false);
ok("incomplete single match stays unknown", (incomplete.duplicate_discovery as { duplicate_payments: boolean | null }).duplicate_payments === null);

const missing = report({
  retrieved: {
    ok: false,
    id: "",
    status: "",
    livemode: null,
    recipient: "",
    payoutMethod: "",
    metadataTxnId: "",
  },
});
ok("unretrieved stored payment is not terminal", missing.terminal_completion === "unconfirmed");
ok("report has zero writes", (missing.mutations as { stripe_writes: number; db_writes: number }).stripe_writes === 0 && (missing.mutations as { db_writes: number }).db_writes === 0);

const encoded = JSON.stringify(pending);
ok("full payment id is not returned", !encoded.includes(PAYMENT));
ok("full quote id is not returned", !encoded.includes(QUOTE));
ok("full recipient id is not returned", !encoded.includes(RECIPIENT));
ok("quote prefix is returned", (pending.quote as { prefix: string }).prefix === "obpq_test_");
ok("payment prefix is returned", (pending.outbound as { prefix: string }).prefix === "obp_test_");
ok("quote amounts are returned", (pending.quote as { source_amount_minor: number; destination_currency: string }).source_amount_minor === 4000 && (pending.quote as { destination_currency: string }).destination_currency === "thb");
ok("redacted hash is eight characters", redactedId(PAYMENT).h8?.length === 8);
ok("terminal helper keeps processing pending", stripeTerminalCompletion("processing") === "pending");
ok("terminal helper confirms posted", stripeTerminalCompletion("posted") === "confirmed");

const io = readFileSync(new URL("../src/lib/payments/payout-rail/preview-sandbox-verify.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../src/app/api/diagnostics/gp-preview-runtime/fixture/verify/route.ts", import.meta.url), "utf8");
ok("verifier does not post to Stripe", !io.includes('method: "POST"') && !io.includes("moneyMutation: true"));
ok("verifier retrieves the stored payment", io.includes("/v2/money_management/outbound_payments/"));
ok("verifier lists with a page cap", io.includes("MAX_LIST_PAGES"));
ok("route is GET only", route.includes("export async function GET") && !route.includes("export async function POST"));
ok("route ignores the request body", route.includes("void req"));

console.log(`\n${passed} passed`);
