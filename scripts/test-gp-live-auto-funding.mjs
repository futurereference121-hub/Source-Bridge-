/**
 * LIVE automatic GP funding/quote execution after buyer authorization.
 * Offline source + pure-function checks. No Stripe money objects.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateBackgroundQuote,
  evaluateLivePilotFundingScope,
  evaluateLivePilotInitiation,
  globalPayoutsReconciliationAllowed,
} from "../src/lib/payments/payout-rail/live-pilot.ts";
import { gpQuoteConfirmationRequired } from "../src/lib/payments/payout-rail/quote-confirmation.ts";
import {
  classifyStoredQuote,
  fundingPrincipalMinor,
  planProceedsAfterQuote,
  proceedsQuoteSourceAmount,
} from "../src/lib/payments/payout-rail/proceeds-funding.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`PASS ${name}`);
}

ok("extra quote confirmation is off for LIVE GP", gpQuoteConfirmationRequired("LIVE", "STRIPE_GLOBAL_PAYOUTS") === false);
ok("extra quote confirmation is off for TEST GP", gpQuoteConfirmationRequired("TEST", "STRIPE_GLOBAL_PAYOUTS") === false);

const outbound = read("src/lib/payments/payout-rail/outbound-payment.ts");
ok("authorized LIVE path no longer calls evaluateQuoteConfirmation", !outbound.includes("evaluateQuoteConfirmation"));
ok("LIVE initiation is still checked before outbound create", outbound.includes("if (!canInitiateGlobalPayoutsMoney"));
ok("Connect outbound is not this file's destination charge path", !outbound.includes("transfer_data.destination"));

const quote = read("src/lib/payments/payout-rail/outbound-quote.ts");
ok("expired authorized quotes may refresh", quote.includes("allowAuthorizedQuoteRefresh"));
ok("replacement quotes keep accepted source amount", quote.includes("sourceAmountMinor: opts.sourceAmountMinor"));

ok(
  "LIVE off blocks new funding",
  evaluateLivePilotFundingScope({
    mode: "LIVE",
    initiationEnabled: false,
    transactionId: "pilot_txn",
    authorizedTransactionIdRaw: "pilot_txn",
    sourceCurrency: "GBP",
    configuredSourceCurrencyRaw: "GBP",
  }).code === "GLOBAL_PAYOUTS_LIVE_INITIATION_DISABLED",
);
ok(
  "wrong LIVE transaction is blocked",
  evaluateLivePilotFundingScope({
    mode: "LIVE",
    initiationEnabled: true,
    transactionId: "other_txn",
    authorizedTransactionIdRaw: "pilot_txn",
    sourceCurrency: "GBP",
    configuredSourceCurrencyRaw: "GBP",
  }).code === "GP_PILOT_TRANSACTION_NOT_AUTHORIZED",
);
ok(
  "missing LIVE transaction id is blocked",
  evaluateLivePilotFundingScope({
    mode: "LIVE",
    initiationEnabled: true,
    transactionId: "pilot_txn",
    authorizedTransactionIdRaw: "",
    sourceCurrency: "GBP",
    configuredSourceCurrencyRaw: "GBP",
  }).code === "GP_PILOT_TRANSACTION_NOT_AUTHORIZED",
);
ok(
  "wrong LIVE currency is blocked",
  evaluateLivePilotFundingScope({
    mode: "LIVE",
    initiationEnabled: true,
    transactionId: "pilot_txn",
    authorizedTransactionIdRaw: "pilot_txn",
    sourceCurrency: "USD",
    configuredSourceCurrencyRaw: "GBP",
  }).code === "GP_PILOT_SOURCE_CURRENCY_INVALID",
);
ok(
  "TEST new money only needs sandbox initiation",
  evaluateLivePilotFundingScope({
    mode: "TEST",
    initiationEnabled: true,
    transactionId: "any_test_txn",
    authorizedTransactionIdRaw: "",
    sourceCurrency: "GBP",
    configuredSourceCurrencyRaw: "",
  }).ok === true,
);

const capDenied = evaluateLivePilotInitiation({
  mode: "LIVE",
  gpEnabled: true,
  userAllowlistRaw: "seller@example.com",
  userId: "seller_1",
  email: "seller@example.com",
  countryAllowed: true,
  actorUserId: "buyer_1",
  buyerId: "buyer_1",
  sourceCurrency: "GBP",
  configuredSourceCurrencyRaw: "GBP",
  amountCapRaw: "2500",
  principalMinor: 3500,
  providerFeeMinor: 0,
  crossBorderFeeMinor: 0,
  fxFeeMinor: 0,
  providerFeeCurrency: "GBP",
  crossBorderFeeCurrency: "GBP",
  fxFeeCurrency: "GBP",
  availableBalanceMinor: 10_000,
  destinationAmountMinor: null,
  destinationCurrency: "",
  destinationQuoted: false,
  destinationMinimumsRaw: "",
  authorizedTransactionIdRaw: "pilot_txn",
  transactionId: "pilot_txn",
});
ok("LIVE cap still fail-closes oversize principal", capDenied.ok === false && capDenied.code === "GP_PILOT_AMOUNT_CAP_EXCEEDED");

const userDenied = evaluateLivePilotInitiation({
  mode: "LIVE",
  gpEnabled: true,
  userAllowlistRaw: "other@example.com",
  userId: "seller_1",
  email: "seller@example.com",
  countryAllowed: true,
  actorUserId: "buyer_1",
  buyerId: "buyer_1",
  sourceCurrency: "GBP",
  configuredSourceCurrencyRaw: "GBP",
  amountCapRaw: "10000",
  principalMinor: 2500,
  providerFeeMinor: 0,
  crossBorderFeeMinor: 0,
  fxFeeMinor: 0,
  providerFeeCurrency: "GBP",
  crossBorderFeeCurrency: "GBP",
  fxFeeCurrency: "GBP",
  availableBalanceMinor: 10_000,
  destinationAmountMinor: null,
  destinationCurrency: "",
  destinationQuoted: false,
  destinationMinimumsRaw: "",
  authorizedTransactionIdRaw: "pilot_txn",
  transactionId: "pilot_txn",
});
ok("unlisted LIVE user is blocked", userDenied.ok === false && userDenied.code === "GP_PILOT_USER_NOT_ALLOWLISTED");

assert.equal(
  fundingPrincipalMinor({
    itemCostMinor: 2000,
    shippingMinor: 500,
    sellerServiceFeeMinor: 1000,
    procurementAuthorizedAmountMinor: 2000,
  }),
  2000,
);
assert.equal(
  fundingPrincipalMinor({
    itemCostMinor: 2000,
    shippingMinor: 500,
    sellerServiceFeeMinor: 1000,
    finalAuthorized: true,
    procurementAuthorizedAmountMinor: 2000,
  }),
  3500,
);
assert.equal(
  proceedsQuoteSourceAmount({
    procurementAmountMinor: 2000,
    procurementCovered: true,
    finalAmountMinor: 1500,
  }),
  1500,
);
ok("procurement and final quote unpaid amounts separately", true);

const expired = evaluateBackgroundQuote({
  stored: {
    quoteId: "obpq_old",
    transactionId: "pilot_txn",
    mode: "LIVE",
    recipientId: "acct_1",
    payoutMethodId: "pm_1",
    sourceAmountMinor: 2000,
    sourceCurrency: "gbp",
    destinationCurrency: "thb",
    destinationAmountMinor: 80_000,
    termsHash: "hash",
    expiresAt: "2026-10-01T07:00:00.000Z",
  },
  mode: "LIVE",
  transactionId: "pilot_txn",
  recipientId: "acct_1",
  payoutMethodId: "pm_1",
  sourceAmountMinor: 2000,
  sourceCurrency: "gbp",
  destinationCurrency: "thb",
  termsHash: "hash",
  nowMs: Date.parse("2026-10-01T08:00:00.000Z"),
  allowRefresh: true,
});
ok("expired matching quote refreshes without another buyer click", expired.ok && expired.action === "refresh");

const changed = evaluateBackgroundQuote({
  stored: {
    quoteId: "obpq_old",
    transactionId: "pilot_txn",
    mode: "LIVE",
    recipientId: "acct_1",
    payoutMethodId: "pm_1",
    sourceAmountMinor: 2000,
    sourceCurrency: "gbp",
    destinationCurrency: "thb",
    destinationAmountMinor: 80_000,
    termsHash: "hash",
    expiresAt: "2026-10-01T09:00:00.000Z",
  },
  mode: "LIVE",
  transactionId: "pilot_txn",
  recipientId: "acct_1",
  payoutMethodId: "pm_1",
  sourceAmountMinor: 2100,
  sourceCurrency: "gbp",
  destinationCurrency: "thb",
  termsHash: "hash",
  nowMs: Date.parse("2026-10-01T08:00:00.000Z"),
  allowRefresh: true,
});
ok("changed accepted amount is refused", changed.ok === false && changed.code === "GP_QUOTE_MISMATCH");

const short = planProceedsAfterQuote({
  quote: "usable",
  principalMinor: 3500,
  payoutFeeMinor: 500,
  chargeNetMinor: 3900,
  postedMinor: 0,
  pendingMinor: 0,
});
ok("insufficient cover fails closed", short.action === "short");

const inflight = planProceedsAfterQuote({
  quote: "usable",
  principalMinor: 2000,
  payoutFeeMinor: 100,
  chargeNetMinor: 3900,
  postedMinor: 0,
  pendingMinor: 2100,
});
ok("pending funding leg blocks a second payout", inflight.action === "wait_inflight");

ok(
  "initiation off still allows webhook recon",
  globalPayoutsReconciliationAllowed({ masterEnabled: true, liveInitiationEnabled: false }) === true,
);
ok(
  "master off stops recon",
  globalPayoutsReconciliationAllowed({ masterEnabled: false, liveInitiationEnabled: true }) === false,
);

const cron = read("src/app/api/cron/payments-release/route.ts");
ok("cron keeps an explicit TEST funding path", cron.includes('stripeMode: "TEST"'));
ok("cron adds LIVE funding behind the live initiation resume gate", cron.includes('stripeMode: "LIVE"') && cron.includes('canInitiateGlobalPayoutsMoney("LIVE")'));
ok("cron does not drop TEST", cron.includes('canInitiateGlobalPayoutsMoney("TEST")'));

const events = read("src/lib/payments/payout-rail/events.ts");
ok("received_credit events use the recon fallback", events.includes("received_credit") && events.includes("onReceivedCreditEvent"));
const fundingRun = read("src/lib/payments/payout-rail/proceeds-funding-run.ts");
ok("received-credit recon does not resume new outbound", fundingRun.includes("resumeAuthorized: false"));
ok("LIVE new funding stays inside the named-pilot helper", fundingRun.includes("evaluateLivePilotFundingScope"));
ok("flags keep LIVE initiation default false", read("src/lib/payments/flags.ts").includes('envBool("GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED", false)'));
const readiness = read("src/lib/payments/payout-rail/live-gp-readiness.ts");
ok("LIVE account snapshot is GET-only", readiness.includes('method: "GET"') && !readiness.includes("POST") && !readiness.includes("moneyMutation: true"));
ok("LIVE write permissions stay unverified", readiness.includes('writePermissions: "unverified"'));
ok("LIVE snapshot reads the platform account without payouts.create", readiness.includes("accounts.retrieve()") && !readiness.includes("payouts.create"));
ok("LIVE snapshot reports GBP available balance", readiness.includes("gbpAvailableMinor"));
ok(
  "event destination list asks for webhook URL and never signing_secret",
  readiness.includes("include[0]=webhook_endpoint.url") &&
    !readiness.includes("webhook_endpoint.signing_secret") &&
    !readiness.includes("include[0]=webhook_endpoint.signing_secret"),
);
ok("redacted destination URL stays unverified instead of a path mismatch", readiness.includes('urlRead === "redacted" ? null'));
ok(
  "outbound coverage requires handler subtypes, not one family event",
  readiness.includes("destinationSubscribesTo(events, REQUIRED_LIVE_GP_OUTBOUND_EVENTS)") &&
    readiness.includes("destinationSubscribesTo(events, REQUIRED_LIVE_GP_RECEIVED_CREDIT_EVENTS)") &&
    !readiness.includes('"v2.money_management.outbound_payment.updated"') &&
    !readiness.includes("destinationCoversFamily"),
);
ok(
  "pinned GP thin events include ReceivedCredit and outbound payment",
  readiness.includes("v2.money_management.received_credit.available") &&
    readiness.includes("v2.money_management.received_credit.failed") &&
    readiness.includes("v2.money_management.received_credit.returned") &&
    readiness.includes("v2.money_management.received_credit.succeeded") &&
    readiness.includes("v2.money_management.outbound_payment.posted") &&
    readiness.includes("v2.money_management.outbound_payment.under_review"),
);
ok(
  "ordinary LIVE tickets resolve the seller payout rail",
  read("src/lib/payments/commercial-quote.ts").includes("resolvePayoutRail") &&
    read("src/lib/payments/commercial-quote.ts").includes('sandboxDecision.state === "pair"'),
);
ok(
  "LIVE stored GP checkout is allowed for ordinary users",
  read("src/lib/payments/checkout.ts").includes('storedMode === "LIVE"') &&
    !read("src/lib/payments/checkout.ts").includes('normalizeStripeMode(txn.stripeMode) !== "TEST"'),
);
const railResolver = read("src/lib/payments/payout-rail/rail-resolver.ts");
ok(
  "LIVE GP onboarding is not sandbox-sourcer-only",
  railResolver.includes('mode !== "LIVE" && !dedicatedSourcer') &&
    !railResolver.includes("!isGlobalPayoutsEnabled() || !dedicatedSourcer"),
);
ok(
  "LIVE GP onboarding still uses country and user allowlists",
  railResolver.includes("isGlobalPayoutsCountryAllowed") &&
    railResolver.includes("isGlobalPayoutsUserAllowed"),
);
ok("admin payments exposes the hashed LIVE snapshot", read("src/app/api/admin/payments/route.ts").includes("gpLiveReadiness"));

ok(
  "unused confirmation helper still classifies missing quotes",
  classifyStoredQuote({
    quoteConfirmationRequired: true,
    quoteId: "",
    expiresAt: "",
    confirmedByUserId: "",
    nowMs: Date.now(),
  }) === "confirmation_required",
);

console.log(`\n${passed} gp-live-auto-funding checks passed`);
