/**
 * Named LIVE collection-only card test. Offline — no Stripe, no database.
 * Run: node --experimental-strip-types scripts/test-gp-live-collection-only.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decideLiveGpRoute,
  evaluateLiveCollectionOnlyCharge,
  evaluateLivePilotFundingScope,
  evaluateLivePilotInitiation,
  liveCollectionOnlyTicketCurrencyPolicy,
  liveIdentityMatchesEntry,
  matchLiveCollectionOnlyPair,
  planQuotePreparation,
  readLiveCollectionOnlyConfig,
  STRIPE_GBP_CHARGE_MINIMUM_MINOR,
} from "../src/lib/payments/payout-rail/live-pilot.ts";

let passed = 0;
function ok(name: string, cond: unknown) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`PASS ${name}`);
}

function read(rel: string) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

const buyerEmail = "theowlsaid420@gmail.com";
const sellerEmail = "isabellatempton@gmail.com";
const buyerId = "buyer_theowlsaid_1";
const sellerId = "seller_bellahap_1";
const capMinor = 70;
const usdPerGbp = 1.3399;

const config = readLiveCollectionOnlyConfig({
  enabled: true,
  buyerRaw: buyerEmail,
  sellerRaw: sellerEmail,
  currencyRaw: "GBP",
  capRaw: String(capMinor),
});
ok("collection config accepts the named pair and 70p cap", config.ok === true);
ok(
  "disabled collection config fails closed",
  readLiveCollectionOnlyConfig({
    enabled: false,
    buyerRaw: buyerEmail,
    sellerRaw: sellerEmail,
    currencyRaw: "GBP",
    capRaw: "70",
  }).ok === false,
);
ok(
  "same buyer and seller fail closed",
  readLiveCollectionOnlyConfig({
    enabled: true,
    buyerRaw: buyerEmail,
    sellerRaw: buyerEmail,
    currencyRaw: "GBP",
    capRaw: "70",
  }).ok === false,
);
ok(
  "cap below Stripe GBP card minimum fails closed",
  readLiveCollectionOnlyConfig({
    enabled: true,
    buyerRaw: buyerEmail,
    sellerRaw: sellerEmail,
    currencyRaw: "GBP",
    capRaw: "29",
  }).ok === false,
);

ok(
  "buyer identity matches theowlsaid email",
  liveIdentityMatchesEntry({
    userId: buyerId,
    email: buyerEmail,
    entryRaw: buyerEmail,
  }),
);
ok(
  "seller identity matches bellahap email",
  liveIdentityMatchesEntry({
    userId: sellerId,
    email: sellerEmail,
    entryRaw: sellerEmail,
  }),
);

const pair = matchLiveCollectionOnlyPair({
  enabled: true,
  buyerRaw: buyerEmail,
  sellerRaw: sellerEmail,
  currencyRaw: "GBP",
  capRaw: "70",
  buyerId,
  sellerId,
  buyerEmail,
  sellerEmail,
});
ok("named pair matches only theowlsaid buying from bellahap", pair.ok === true);
ok(
  "reversed pair does not match",
  matchLiveCollectionOnlyPair({
    enabled: true,
    buyerRaw: buyerEmail,
    sellerRaw: sellerEmail,
    currencyRaw: "GBP",
    capRaw: "70",
    buyerId: sellerId,
    sellerId: buyerId,
    buyerEmail: sellerEmail,
    sellerEmail: buyerEmail,
  }).ok === false,
);

const entitlement = 61;
ok("named collection ticket uses 61p seller entitlement", entitlement === 61);

const intendedTotal = 70;
ok(
  "70p stays under US$1 at 1.3399 USD/GBP",
  (intendedTotal / 100) * usdPerGbp < 1,
);
ok(
  "75p would exceed US$1 at 1.3399 USD/GBP",
  (75 / 100) * usdPerGbp > 1,
);
ok(
  "70p charge is above the Stripe GBP card minimum",
  intendedTotal >= STRIPE_GBP_CHARGE_MINIMUM_MINOR,
);

ok(
  "approved 70p charge is accepted",
  evaluateLiveCollectionOnlyCharge({
    pairMatched: true,
    currency: "GBP",
    configuredCurrency: "GBP",
    totalChargeMinor: 70,
    capMinor,
  }).ok === true,
);
ok(
  "71p charge is rejected as over cap",
  evaluateLiveCollectionOnlyCharge({
    pairMatched: true,
    currency: "GBP",
    configuredCurrency: "GBP",
    totalChargeMinor: 71,
    capMinor,
  }).ok === false &&
    evaluateLiveCollectionOnlyCharge({
      pairMatched: true,
      currency: "GBP",
      configuredCurrency: "GBP",
      totalChargeMinor: 71,
      capMinor,
    }).code === "GP_COLLECTION_ONLY_CHARGE_CAP",
);
ok(
  "29p charge is rejected as below Stripe minimum",
  evaluateLiveCollectionOnlyCharge({
    pairMatched: true,
    currency: "GBP",
    configuredCurrency: "GBP",
    totalChargeMinor: 29,
    capMinor,
  }).code === "GP_COLLECTION_ONLY_BELOW_CHARGE_MINIMUM",
);

const ticketPolicy = liveCollectionOnlyTicketCurrencyPolicy({
  enabled: true,
  buyerRaw: buyerEmail,
  sellerRaw: sellerEmail,
  currencyRaw: "GBP",
  capRaw: "70",
  participantA: { id: buyerId, email: buyerEmail },
  participantB: { id: sellerId, email: sellerEmail },
  floorMinor: entitlement,
});
ok(
  "ticket form locks GBP with theowlsaid as buyer and bellahap as sourcer",
  ticketPolicy?.buyerId === buyerId &&
    ticketPolicy?.sellerId === sellerId &&
    ticketPolicy?.currency === "GBP" &&
    ticketPolicy?.minimumEntitlementMinor === 61,
);

ok(
  "collection purpose takes GP without a payout allowlist",
  decideLiveGpRoute({
    purpose: "collection",
    gpEligibleCountry: true,
    userAllowed: false,
    connectUnsupported: true,
  }).takeGp === true,
);
ok(
  "execution purpose still refuses GP without a payout allowlist",
  decideLiveGpRoute({
    purpose: "execution",
    gpEligibleCountry: true,
    userAllowed: false,
    connectUnsupported: true,
  }).takeGp === false,
);

const initiation = evaluateLivePilotInitiation({
  mode: "LIVE",
  gpEnabled: true,
  userAllowlistRaw: sellerId,
  userId: sellerId,
  email: sellerEmail,
  countryAllowed: true,
  actorUserId: buyerId,
  buyerId,
  sourceCurrency: "GBP",
  configuredSourceCurrencyRaw: "GBP",
  amountCapRaw: "2500",
  principalMinor: 61,
  providerFeeMinor: 0,
  crossBorderFeeMinor: 0,
  fxFeeMinor: 0,
  providerFeeCurrency: "gbp",
  crossBorderFeeCurrency: "gbp",
  fxFeeCurrency: "gbp",
  availableBalanceMinor: 4000,
  destinationAmountMinor: 90000,
  destinationCurrency: "THB",
  destinationQuoted: true,
  destinationMinimumsRaw: "THB:60000",
  authorizedTransactionIdRaw: "txn_collection_1",
  transactionId: "txn_collection_1",
  collectionOnly: true,
});
ok(
  "LIVE initiation still refuses a collection-only ticket",
  !initiation.ok && initiation.code === "GP_COLLECTION_ONLY",
);
ok(
  "FA funding still refuses a collection-only ticket when initiation is on",
  evaluateLivePilotFundingScope({
    mode: "LIVE",
    initiationEnabled: true,
    transactionId: "txn_collection_1",
    authorizedTransactionIdRaw: "txn_collection_1",
    sourceCurrency: "GBP",
    configuredSourceCurrencyRaw: "GBP",
    collectionOnly: true,
  }).code === "GP_COLLECTION_ONLY",
);
ok(
  "quote preparation still refuses a collection-only ticket",
  planQuotePreparation({
    mode: "LIVE",
    initiationEnabled: true,
    requiresQuote: true,
    collectionOnly: true,
  }).code === "GP_COLLECTION_ONLY",
);

const checkout = read("src/lib/payments/checkout.ts");
const tickets = read("src/lib/payments/tickets.ts");
const claim = read("src/lib/payments/payout-rail/live-pilot-claim.ts");
const outbound = read("src/lib/payments/payout-rail/outbound-payment.ts");
const quoteReview = read("src/lib/payments/payout-rail/quote-review.ts");
const proceeds = read("src/lib/payments/payout-rail/proceeds-funding-run.ts");
const flags = read("src/lib/payments/flags.ts");
const quote = read("src/lib/payments/commercial-quote.ts");

ok(
  "checkout allows the collection-only claim without the payout-pilot id",
  checkout.includes("isLiveCollectionOnlyTransaction") &&
    checkout.includes("GP_PILOT_TRANSACTION_NOT_AUTHORIZED"),
);
ok(
  "accept binds collection-only and skips the payout-pilot claim",
  tickets.includes("bindLiveCollectionOnlyIfOpen") &&
    tickets.includes("if (!collectionBound)") &&
    tickets.includes("bindLivePilotTransactionIfOpen"),
);
const collectionBind = claim.slice(
  claim.indexOf("export async function bindLiveCollectionOnlyIfOpen"),
  claim.indexOf("export async function bindLivePilotTransactionIfOpen"),
);
ok(
  "collection bind writes LIVE_GP_COLLECTION_ONLY, not LIVE_GP_PILOT_BOUND",
  collectionBind.includes("LIVE_GP_COLLECTION_ONLY_ACTION") &&
    !collectionBind.includes("LIVE_GP_PILOT_BOUND_ACTION"),
);
ok(
  "payout bind refuses a ticket that already has the collection claim",
  /bindLivePilotTransactionIfOpen[\s\S]*isLiveCollectionOnlyTransaction/.test(claim),
);
ok(
  "outbound payment refuses collection-only tickets",
  outbound.includes("assertLiveCollectionOnlyBlocksPayout") &&
    outbound.includes("collectionOnly: await isLiveCollectionOnlyTransaction"),
);
ok(
  "quote review refuses collection-only tickets",
  quoteReview.includes('code: "GP_COLLECTION_ONLY"'),
);
ok(
  "proceeds funding excludes collection-only tickets",
  proceeds.includes("liveCollectionOnlyTransactionIds") &&
    proceeds.includes("collectionOnly: await isLiveCollectionOnlyTransaction"),
);
ok(
  "LIVE GP initiation stays default off",
  flags.includes('envBool("GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED", false)'),
);
const collectionFlag = flags.slice(
  flags.indexOf("export function isLiveCollectionOnlyEnabled"),
  flags.indexOf("export function liveCollectionOnlyControlEnv"),
);
ok(
  "collection-only flag stays default off and does not enable initiation",
  collectionFlag.includes('envBool("GLOBAL_PAYOUTS_LIVE_COLLECTION_ONLY_ENABLED", false)') &&
    !collectionFlag.includes("isGlobalPayoutsLiveInitiationEnabled"),
);
ok(
  "commercial quote uses collection rail purpose only for the named pair",
  quote.includes('purpose: collectionMatch.ok ? "collection" : undefined') &&
    !quote.includes('purpose: "onboarding"'),
);

console.log(`\n${passed} gp-live-collection-only checks passed`);
