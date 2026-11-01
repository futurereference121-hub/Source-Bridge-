/**
 * Restricted Global Payouts LIVE pilot decisions.
 * Pure functions only — no Stripe calls and no database access.
 *
 * An accepted quote debits the payout principal. Itemized estimated fees are
 * outside that debit, in the source currency. The cap and the financial-account
 * check cover the principal plus those fees once. They are not added to the
 * buyer total and are not deducted from sourcer entitlement.
 */

/** Cap and funding cover the quoted principal debit plus separate same-currency fees. */
export const PILOT_CAP_COVERS = "quoted_debit_plus_separate_source_fees" as const;

/** One transaction-scoped lock key for the single LIVE pilot payment. */
export const LIVE_PILOT_LOCK_KEY = 87264011;

/** FinancialAuditEvent.action for the durable named-pilot bind. */
export const LIVE_GP_PILOT_BOUND_ACTION = "LIVE_GP_PILOT_BOUND";

/** Durable collection-only LIVE ticket. Never authorizes FA funding or seller payout. */
export const LIVE_GP_COLLECTION_ONLY_ACTION = "LIVE_GP_COLLECTION_ONLY";

/** Separate from the payout-pilot lock so this ticket cannot occupy that slot. */
export const LIVE_COLLECTION_LOCK_KEY = 87264012;

/** Stripe Global Payouts Thailand wire destination minimum: ฿600.00. */
export const STRIPE_GP_THB_WIRE_MINIMUM_MINOR = 60_000;

/** Stripe published GBP card charge minimum. */
export const STRIPE_GBP_CHARGE_MINIMUM_MINOR = 30;

/**
 * Conservative THB per GBP used only to size the LIVE-pilot GBP floor.
 * Thousandths: 41000 = 41.000 THB / GBP.
 * Observed TEST Stripe quotes were 44.53–45.18 (Oct 2026). Mid-market ~45.20.
 * This haircut keeps destination satang above ฿600 if LIVE quotes ~8% worse.
 */
export const LIVE_PILOT_THB_PER_GBP_MILLI = 41_000;

export const PROVIDER_FEE_PAYER = "Source Bridge";

export const GP_POSTED_WORDING =
  "Posted means funds left the financial account. It does not confirm the recipient bank has paid.";

const EMAIL_ENTRY = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID_ENTRY = /^[a-z0-9_-]{8,64}$/i;
const CURRENCY = /^[A-Z]{3}$/;
const POSITIVE_MINOR = /^[1-9]\d*$/;
const TXN_ID = /^[A-Za-z0-9_-]{8,80}$/;

export function parseAllowlist(raw: string): string[] {
  return String(raw || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isValidLiveAllowlistEntry(entry: string): boolean {
  return EMAIL_ENTRY.test(entry) || ID_ENTRY.test(entry);
}

/** Onboarding is country-gated. Execution still requires the LIVE pilot user allowlist. Collection is a named pair for card capture only. */
export type PayoutRailPurpose = "onboarding" | "execution" | "collection";

/**
 * Pure LIVE/TEST GP routing decision after Connect-in-progress checks.
 * Onboarding: supported GP country is enough.
 * Execution: supported GP country AND user allowlist.
 */
export function decideLiveGpRoute(opts: {
  purpose: PayoutRailPurpose;
  gpEligibleCountry: boolean;
  userAllowed: boolean;
  connectUnsupported: boolean;
}): {
  takeGp: boolean;
  unsupported: boolean;
  reason: string;
} {
  if (
    opts.gpEligibleCountry &&
    (opts.purpose === "onboarding" ||
      opts.purpose === "collection" ||
      opts.userAllowed)
  ) {
    return { takeGp: true, unsupported: false, reason: "gp_candidate" };
  }
  if (opts.connectUnsupported) {
    return {
      takeGp: false,
      unsupported: true,
      reason: !opts.gpEligibleCountry
        ? "connect_unsupported_country_not_allowlisted"
        : "user_not_allowlisted",
    };
  }
  return { takeGp: false, unsupported: false, reason: "connect_default" };
}

/**
 * TEST: an empty user allowlist stays an open ramp behind the country gate.
 * LIVE: an empty list, a wildcard, or any invalid entry denies everyone.
 */
export function liveIdentityMatchesEntry(opts: {
  userId: string;
  email?: string | null;
  entryRaw: string;
}): boolean {
  return liveUserAllowed({
    enabled: true,
    mode: "LIVE",
    allowlistRaw: opts.entryRaw,
    userId: opts.userId,
    email: opts.email,
  });
}

export function readLiveCollectionOnlyConfig(opts: {
  enabled: boolean;
  buyerRaw: string;
  sellerRaw: string;
  currencyRaw: string;
  capRaw: string;
}):
  | { ok: true; buyer: string; seller: string; currency: string; capMinor: number }
  | { ok: false } {
  if (!opts.enabled) return { ok: false };
  const buyerList = parseAllowlist(opts.buyerRaw);
  const sellerList = parseAllowlist(opts.sellerRaw);
  if (buyerList.length !== 1 || sellerList.length !== 1) return { ok: false };
  if (!buyerList.every(isValidLiveAllowlistEntry) || !sellerList.every(isValidLiveAllowlistEntry)) {
    return { ok: false };
  }
  if (buyerList[0] === sellerList[0]) return { ok: false };
  const currency = parsePilotSourceCurrency(opts.currencyRaw);
  const capMinor = parsePilotAmountCapMinor(opts.capRaw);
  if (!currency || capMinor == null || capMinor < STRIPE_GBP_CHARGE_MINIMUM_MINOR) {
    return { ok: false };
  }
  return {
    ok: true,
    buyer: buyerList[0],
    seller: sellerList[0],
    currency,
    capMinor,
  };
}

export function matchLiveCollectionOnlyPair(opts: {
  enabled: boolean;
  buyerRaw: string;
  sellerRaw: string;
  currencyRaw: string;
  capRaw: string;
  buyerId: string;
  sellerId: string;
  buyerEmail?: string | null;
  sellerEmail?: string | null;
}):
  | { ok: true; currency: string; capMinor: number }
  | { ok: false } {
  const config = readLiveCollectionOnlyConfig(opts);
  if (!config.ok) return { ok: false };
  if (opts.buyerId === opts.sellerId) return { ok: false };
  const buyerOk = liveIdentityMatchesEntry({
    userId: opts.buyerId,
    email: opts.buyerEmail,
    entryRaw: config.buyer,
  });
  const sellerOk = liveIdentityMatchesEntry({
    userId: opts.sellerId,
    email: opts.sellerEmail,
    entryRaw: config.seller,
  });
  if (!buyerOk || !sellerOk) return { ok: false };
  return { ok: true, currency: config.currency, capMinor: config.capMinor };
}

export function evaluateLiveCollectionOnlyCharge(opts: {
  pairMatched: boolean;
  currency: string;
  configuredCurrency: string;
  totalChargeMinor: number;
  capMinor: number;
}): { ok: true } | { ok: false; code: string } {
  if (!opts.pairMatched) return { ok: false, code: "GP_COLLECTION_ONLY_PAIR" };
  const currency = parsePilotSourceCurrency(opts.currency);
  const configured = parsePilotSourceCurrency(opts.configuredCurrency);
  if (!currency || !configured || currency !== configured) {
    return { ok: false, code: "GP_COLLECTION_ONLY_CURRENCY" };
  }
  if (!Number.isInteger(opts.totalChargeMinor) || opts.totalChargeMinor < STRIPE_GBP_CHARGE_MINIMUM_MINOR) {
    return { ok: false, code: "GP_COLLECTION_ONLY_BELOW_CHARGE_MINIMUM" };
  }
  if (opts.totalChargeMinor > opts.capMinor) {
    return { ok: false, code: "GP_COLLECTION_ONLY_CHARGE_CAP" };
  }
  return { ok: true };
}

export function liveCollectionOnlyTicketCurrencyPolicy(opts: {
  enabled: boolean;
  buyerRaw: string;
  sellerRaw: string;
  currencyRaw: string;
  capRaw: string;
  participantA: { id: string; email?: string | null };
  participantB: { id: string; email?: string | null };
  floorMinor: number;
}): {
  buyerId: string;
  sellerId: string;
  currency: "GBP";
  minimumEntitlementMinor: number;
} | null {
  if (!Number.isInteger(opts.floorMinor) || opts.floorMinor <= 0) return null;
  const attempts = [
    { buyer: opts.participantA, seller: opts.participantB },
    { buyer: opts.participantB, seller: opts.participantA },
  ];
  for (const attempt of attempts) {
    const matched = matchLiveCollectionOnlyPair({
      enabled: opts.enabled,
      buyerRaw: opts.buyerRaw,
      sellerRaw: opts.sellerRaw,
      currencyRaw: opts.currencyRaw,
      capRaw: opts.capRaw,
      buyerId: attempt.buyer.id,
      sellerId: attempt.seller.id,
      buyerEmail: attempt.buyer.email,
      sellerEmail: attempt.seller.email,
    });
    if (matched.ok && matched.currency === "GBP") {
      return {
        buyerId: attempt.buyer.id,
        sellerId: attempt.seller.id,
        currency: "GBP",
        minimumEntitlementMinor: opts.floorMinor,
      };
    }
  }
  return null;
}

export function liveUserAllowed(opts: {
  enabled: boolean;
  mode: "TEST" | "LIVE";
  allowlistRaw: string;
  userId: string;
  email?: string | null;
}): boolean {
  if (!opts.enabled) return false;
  const list = parseAllowlist(opts.allowlistRaw);
  if (opts.mode === "LIVE") {
    if (list.length === 0 || !list.every(isValidLiveAllowlistEntry)) return false;
  } else if (list.length === 0) {
    return true;
  }
  const id = opts.userId.trim().toLowerCase();
  const email = String(opts.email || "").trim().toLowerCase();
  return list.includes(id) || (email.length > 0 && list.includes(email));
}

export function parsePilotSourceCurrency(raw: string): string | null {
  const text = String(raw || "").trim().toUpperCase();
  if (!CURRENCY.test(text)) return null;
  return text;
}

export function parsePilotAmountCapMinor(raw: string): number | null {
  const text = String(raw || "").trim();
  if (!POSITIVE_MINOR.test(text)) return null;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

export function parsePilotTransactionId(raw: string): string | null {
  const text = String(raw || "").trim();
  if (!TXN_ID.test(text)) return null;
  return text;
}

/**
 * Env transaction id wins. Empty env uses the durable first-accept claim.
 * Missing both fails closed at the caller.
 */
export function resolveAuthorizedPilotTransactionId(opts: {
  envRaw: string;
  claimedTransactionId?: string | null;
}): string | null {
  const fromEnv = parsePilotTransactionId(opts.envRaw);
  if (fromEnv) return fromEnv;
  return parsePilotTransactionId(String(opts.claimedTransactionId || "")) || null;
}

export function evaluateLivePilotTransactionClaim(opts: {
  existingClaimedId: string | null;
  candidateTransactionId: string;
}):
  | { ok: true; transactionId: string; alreadyClaimed: boolean }
  | { ok: false; code: "GP_PILOT_TRANSACTION_NOT_AUTHORIZED" } {
  const candidate = parsePilotTransactionId(opts.candidateTransactionId);
  if (!candidate) return { ok: false, code: "GP_PILOT_TRANSACTION_NOT_AUTHORIZED" };
  const existing = parsePilotTransactionId(opts.existingClaimedId || "");
  if (!existing) return { ok: true, transactionId: candidate, alreadyClaimed: false };
  if (existing === candidate) {
    return { ok: true, transactionId: candidate, alreadyClaimed: true };
  }
  return { ok: false, code: "GP_PILOT_TRANSACTION_NOT_AUTHORIZED" };
}

/**
 * Smallest GBP minor units whose Stripe dest conversion at `thbPerGbpMilli`
 * is at least `thbMinor`. Integer ceil. Null when inputs are unusable.
 */
export function gbpMinorToClearThbDestination(opts: {
  thbMinor: number;
  thbPerGbpMilli: number;
}): number | null {
  if (!Number.isInteger(opts.thbMinor) || opts.thbMinor <= 0) return null;
  if (!Number.isInteger(opts.thbPerGbpMilli) || opts.thbPerGbpMilli <= 0) return null;
  const product = opts.thbMinor * (10 ** 3);
  return Math.ceil(product / opts.thbPerGbpMilli);
}

/**
 * When the sourcer is the LIVE GP execution seller, lock the ticket form to GBP
 * at the live-pilot floor. Ordinary chats stay unlocked.
 */
export function liveGpTicketCurrencyPolicy(opts: {
  participantA: { id: string; userAllowed: boolean; gpCountry: boolean };
  participantB: { id: string; userAllowed: boolean; gpCountry: boolean };
  floorMinor: number;
}): {
  buyerId: string;
  sellerId: string;
  currency: "GBP";
  minimumEntitlementMinor: number;
} | null {
  if (!Number.isInteger(opts.floorMinor) || opts.floorMinor <= 0) return null;
  const a = opts.participantA;
  const b = opts.participantB;
  if (!a.id || !b.id || a.id === b.id) return null;
  const seller =
    a.userAllowed && a.gpCountry ? a : b.userAllowed && b.gpCountry ? b : null;
  if (!seller) return null;
  const buyer = seller.id === a.id ? b : a;
  return {
    buyerId: buyer.id,
    sellerId: seller.id,
    currency: "GBP",
    minimumEntitlementMinor: opts.floorMinor,
  };
}

export function parseDestinationMinimums(
  raw: string,
): { ok: true; minimums: Record<string, number> } | { ok: false; code: "GP_PILOT_DESTINATION_MINIMUMS_INVALID" } {
  const text = String(raw || "").trim();
  if (!text) return { ok: true, minimums: {} };
  const minimums: Record<string, number> = {};
  for (const part of text.split(",")) {
    const piece = part.trim();
    if (!piece) return { ok: false, code: "GP_PILOT_DESTINATION_MINIMUMS_INVALID" };
    const [currencyRaw, amountRaw] = piece.split(":");
    const currency = parsePilotSourceCurrency(currencyRaw || "");
    const amount = parsePilotAmountCapMinor(amountRaw || "");
    if (!currency || amount == null || minimums[currency] != null) {
      return { ok: false, code: "GP_PILOT_DESTINATION_MINIMUMS_INVALID" };
    }
    minimums[currency] = amount;
  }
  return { ok: true, minimums };
}

export function quotedPayoutCover(opts: {
  principalMinor: number;
  sourceCurrency: string;
  providerFeeMinor: number;
  crossBorderFeeMinor: number;
  fxFeeMinor: number;
  providerFeeCurrency: string;
  crossBorderFeeCurrency: string;
  fxFeeCurrency: string;
}):
  | { ok: true; separateFeeMinor: number; requiredCoverMinor: number }
  | { ok: false; code: "GP_PILOT_FEE_CURRENCY_UNRESOLVED" } {
  const sourceCurrency = parsePilotSourceCurrency(opts.sourceCurrency);
  if (!sourceCurrency || !Number.isInteger(opts.principalMinor) || opts.principalMinor <= 0) {
    return { ok: false, code: "GP_PILOT_FEE_CURRENCY_UNRESOLVED" };
  }
  const provider = feeDebit(opts.providerFeeMinor, opts.providerFeeCurrency, sourceCurrency);
  const crossBorder = feeDebit(opts.crossBorderFeeMinor, opts.crossBorderFeeCurrency, sourceCurrency);
  const fx = feeDebit(opts.fxFeeMinor, opts.fxFeeCurrency, sourceCurrency);
  if (!provider.ok || !crossBorder.ok || !fx.ok) {
    return { ok: false, code: "GP_PILOT_FEE_CURRENCY_UNRESOLVED" };
  }
  const separateFeeMinor = provider.amount + crossBorder.amount + fx.amount;
  const requiredCoverMinor = opts.principalMinor + separateFeeMinor;
  if (!Number.isSafeInteger(requiredCoverMinor)) {
    return { ok: false, code: "GP_PILOT_FEE_CURRENCY_UNRESOLVED" };
  }
  return { ok: true, separateFeeMinor, requiredCoverMinor };
}

function feeDebit(
  amount: number,
  currency: string,
  sourceCurrency: string,
): { ok: true; amount: number } | { ok: false; code: "GP_PILOT_FEE_CURRENCY_UNRESOLVED" } {
  if (!Number.isInteger(amount) || amount < 0) {
    return { ok: false, code: "GP_PILOT_FEE_CURRENCY_UNRESOLVED" };
  }
  if (amount === 0) return { ok: true, amount: 0 };
  if (currency.trim().toUpperCase() !== sourceCurrency) {
    return { ok: false, code: "GP_PILOT_FEE_CURRENCY_UNRESOLVED" };
  }
  return { ok: true, amount };
}

export function evaluateLivePilotInitiation(opts: {
  mode: "TEST" | "LIVE";
  gpEnabled: boolean;
  userAllowlistRaw: string;
  userId: string;
  email?: string | null;
  countryAllowed: boolean;
  actorUserId: string;
  buyerId: string;
  sourceCurrency: string;
  configuredSourceCurrencyRaw: string;
  amountCapRaw: string;
  principalMinor: number;
  providerFeeMinor: number;
  crossBorderFeeMinor: number;
  fxFeeMinor: number;
  providerFeeCurrency: string;
  crossBorderFeeCurrency: string;
  fxFeeCurrency: string;
  availableBalanceMinor: number | null;
  destinationAmountMinor: number | null;
  destinationCurrency: string;
  destinationQuoted: boolean;
  destinationMinimumsRaw: string;
  authorizedTransactionIdRaw: string;
  transactionId: string;
  /** Named collection-only LIVE tickets never authorize seller payout. */
  collectionOnly?: boolean;
  /** Set only after a recorded buyer action. Never the worker's user id. */
  durableBuyerId?: string | null;
}):
  | {
      ok: true;
      capCovers: typeof PILOT_CAP_COVERS;
      principalMinor: number;
      providerFeeTotalMinor: number;
      totalSourceDebitMinor: number;
      capMinor: number;
    }
  | { ok: false; code: string } {
  if (opts.collectionOnly) return { ok: false, code: "GP_COLLECTION_ONLY" };
  if (opts.mode !== "LIVE") {
    return {
      ok: true,
      capCovers: PILOT_CAP_COVERS,
      principalMinor: opts.principalMinor,
      providerFeeTotalMinor: 0,
      totalSourceDebitMinor: opts.principalMinor,
      capMinor: 0,
    };
  }
  if (!opts.gpEnabled) return { ok: false, code: "GLOBAL_PAYOUTS_DISABLED" };
  // A background worker is not the buyer. Durable authorization is checked
  // separately and must name this transaction's buyer. It does not fill actorUserId.
  if (opts.durableBuyerId) {
    if (opts.actorUserId || opts.durableBuyerId !== opts.buyerId) {
      return { ok: false, code: "GP_PILOT_ACTOR_UNAUTHORIZED" };
    }
  } else if (opts.actorUserId !== opts.buyerId || !opts.actorUserId) {
    return { ok: false, code: "GP_PILOT_ACTOR_UNAUTHORIZED" };
  }
  if (
    !liveUserAllowed({
      enabled: true,
      mode: "LIVE",
      allowlistRaw: opts.userAllowlistRaw,
      userId: opts.userId,
      email: opts.email,
    })
  ) {
    return { ok: false, code: "GP_PILOT_USER_NOT_ALLOWLISTED" };
  }
  if (!opts.countryAllowed) return { ok: false, code: "GP_PILOT_COUNTRY_NOT_ALLOWLISTED" };

  const configuredCurrency = parsePilotSourceCurrency(opts.configuredSourceCurrencyRaw);
  const sourceCurrency = parsePilotSourceCurrency(opts.sourceCurrency);
  if (!configuredCurrency || !sourceCurrency || configuredCurrency !== sourceCurrency) {
    return { ok: false, code: "GP_PILOT_SOURCE_CURRENCY_INVALID" };
  }
  const capMinor = parsePilotAmountCapMinor(opts.amountCapRaw);
  if (capMinor == null) return { ok: false, code: "GP_PILOT_AMOUNT_CAP_INVALID" };
  const authorizedTxn = parsePilotTransactionId(opts.authorizedTransactionIdRaw);
  if (!authorizedTxn || authorizedTxn !== opts.transactionId) {
    return { ok: false, code: "GP_PILOT_TRANSACTION_NOT_AUTHORIZED" };
  }
  if (!Number.isInteger(opts.principalMinor) || opts.principalMinor <= 0) {
    return { ok: false, code: "GP_PILOT_AMOUNT_CAP_EXCEEDED" };
  }
  if (opts.principalMinor > capMinor) return { ok: false, code: "GP_PILOT_AMOUNT_CAP_EXCEEDED" };

  const cover = quotedPayoutCover({
    principalMinor: opts.principalMinor,
    sourceCurrency,
    providerFeeMinor: opts.providerFeeMinor,
    crossBorderFeeMinor: opts.crossBorderFeeMinor,
    fxFeeMinor: opts.fxFeeMinor,
    providerFeeCurrency: opts.providerFeeCurrency,
    crossBorderFeeCurrency: opts.crossBorderFeeCurrency,
    fxFeeCurrency: opts.fxFeeCurrency,
  });
  if (!cover.ok) return cover;
  const providerFeeTotalMinor = cover.separateFeeMinor;
  // Fees are outside the quoted debit. Cover them once; do not add another currency.
  const totalSourceDebitMinor = cover.requiredCoverMinor;
  if (totalSourceDebitMinor > capMinor) return { ok: false, code: "GP_PILOT_AMOUNT_CAP_EXCEEDED" };

  if (opts.availableBalanceMinor == null || !Number.isInteger(opts.availableBalanceMinor)) {
    return { ok: false, code: "GP_PILOT_FUNDING_UNVERIFIED" };
  }
  if (opts.availableBalanceMinor < totalSourceDebitMinor) {
    return { ok: false, code: "GP_PILOT_FUNDING_SHORT" };
  }

  const minimums = parseDestinationMinimums(opts.destinationMinimumsRaw);
  if (!minimums.ok) return minimums;
  if (opts.destinationQuoted) {
    const destinationCurrency = parsePilotSourceCurrency(opts.destinationCurrency);
    if (!destinationCurrency) return { ok: false, code: "GP_PILOT_DESTINATION_MINIMUM" };
    const minimum = minimums.minimums[destinationCurrency];
    if (minimum != null) {
      if (opts.destinationAmountMinor == null || opts.destinationAmountMinor < minimum) {
        return { ok: false, code: "GP_PILOT_DESTINATION_MINIMUM" };
      }
    }
  }

  return {
    ok: true,
    capCovers: PILOT_CAP_COVERS,
    principalMinor: opts.principalMinor,
    providerFeeTotalMinor,
    totalSourceDebitMinor,
    capMinor,
  };
}

export type PilotAttemptSnapshot = {
  id: string;
  transactionId: string;
  outboundPaymentId: string;
  status: string;
  failureCode: string;
  initiatedAt?: string | null;
};

const STICKY_FAILURE = new Set([
  "GP_UNDER_REVIEW",
  "GP_PILOT_SLOT",
  "GP_PAYMENT_OUTCOME_UNCERTAIN",
]);

export function pilotFailureIsSticky(failureCode: string | null | undefined): boolean {
  return STICKY_FAILURE.has(String(failureCode || ""));
}

const OCCUPYING_STATUSES = new Set(["PROCESSING", "SUCCEEDED", "RECONCILED", "ACTION_REQUIRED"]);

function attemptOccupiesPilot(row: PilotAttemptSnapshot): boolean {
  if (row.outboundPaymentId) return true;
  if (row.initiatedAt) return true;
  if (OCCUPYING_STATUSES.has(row.status)) return true;
  if (pilotFailureIsSticky(row.failureCode)) return true;
  if (row.status === "PENDING" || row.status === "AWAITING_FA_FUNDS" || row.status === "AWAITING_MINIMUM") {
    return true;
  }
  return false;
}

function claimingRowIsFresh(row: PilotAttemptSnapshot): boolean {
  return (
    !row.outboundPaymentId &&
    !row.initiatedAt &&
    !pilotFailureIsSticky(row.failureCode) &&
    row.status === "PENDING"
  );
}

/**
 * Only the authorized transaction may initiate. A submitted, in-flight,
 * under-review, or claimed attempt blocks every other initiation, including
 * a second attempt on the same transaction.
 */
export function evaluatePilotOccupancy(opts: {
  authorizedTransactionId: string;
  requestedTransactionId: string;
  claimingAttemptId: string;
  attempts: PilotAttemptSnapshot[];
}): { ok: true } | { ok: false; code: "GP_PILOT_TRANSACTION_NOT_AUTHORIZED" | "GP_PILOT_PAYMENT_ALREADY_STARTED" } {
  if (!opts.authorizedTransactionId || opts.requestedTransactionId !== opts.authorizedTransactionId) {
    return { ok: false, code: "GP_PILOT_TRANSACTION_NOT_AUTHORIZED" };
  }
  for (const row of opts.attempts) {
    if (!attemptOccupiesPilot(row)) continue;
    if (row.id === opts.claimingAttemptId && claimingRowIsFresh(row)) continue;
    return { ok: false, code: "GP_PILOT_PAYMENT_ALREADY_STARTED" };
  }
  return { ok: true };
}

export type QuoteConfirmationSnapshot = {
  quoteId?: string;
  confirmedByUserId?: string;
  transactionId?: string;
  mode?: string;
  recipientId?: string;
  payoutMethodId?: string;
  sourceAmountMinor?: number;
  sourceCurrency?: string;
  destinationAmountMinor?: number;
  destinationCurrency?: string;
  providerFeeMinor?: number;
  crossBorderFeeMinor?: number;
  fxFeeMinor?: number;
  providerFeeCurrency?: string;
  crossBorderFeeCurrency?: string;
  fxFeeCurrency?: string;
  expiresAt?: string;
  termsHash?: string;
};

export function evaluateQuoteConfirmation(opts: {
  stored: QuoteConfirmationSnapshot | null;
  actorUserId: string;
  transactionId: string;
  mode: "TEST" | "LIVE";
  recipientId: string;
  payoutMethodId: string;
  sourceAmountMinor: number;
  sourceCurrency: string;
  destinationCurrency: string;
  termsHash: string;
  nowMs: number;
}): { ok: true; quoteId: string } | { ok: false; code: string } {
  const stored = opts.stored;
  if (!stored?.quoteId || !stored.confirmedByUserId) {
    return { ok: false, code: "GP_QUOTE_REVIEW_REQUIRED" };
  }
  if (stored.confirmedByUserId !== opts.actorUserId) {
    return { ok: false, code: "GP_QUOTE_ACTOR_MISMATCH" };
  }
  const expiresMs = Date.parse(stored.expiresAt || "");
  if (!stored.expiresAt || Number.isNaN(expiresMs) || expiresMs <= opts.nowMs) {
    return { ok: false, code: "GP_QUOTE_EXPIRED" };
  }
  const source = opts.sourceCurrency.toLowerCase();
  const destination = opts.destinationCurrency.toLowerCase();
  if (
    stored.transactionId !== opts.transactionId ||
    stored.mode !== opts.mode ||
    stored.recipientId !== opts.recipientId ||
    stored.payoutMethodId !== opts.payoutMethodId ||
    stored.termsHash !== opts.termsHash ||
    stored.sourceAmountMinor !== opts.sourceAmountMinor ||
    stored.sourceCurrency !== source ||
    stored.destinationCurrency !== destination ||
    !Number.isInteger(stored.destinationAmountMinor) ||
    (stored.destinationAmountMinor ?? 0) <= 0
  ) {
    return { ok: false, code: "GP_QUOTE_MISMATCH" };
  }
  return { ok: true, quoteId: stored.quoteId };
}

export type DurableReleasePurpose = "INSPECTION_EXPIRY" | "AUTHORIZED_RETRY";

/** Verified from a financial audit row. recordedActorUserId is that row's actor, not a copy of the buyer id. */
export type BackgroundReleaseAuthorization = {
  buyerId: string;
  action: "START_INSPECTION" | "BUYER_RELEASE_NOW";
  purpose: DurableReleasePurpose;
  recordedActorUserId: string;
};

/**
 * Recorded buyer authorization for a background release.
 * This is not a second quote-confirmation click. The worker user id must be
 * empty. confirmedByUserId is not written here.
 *
 * Stripe API 2026-08-26.preview locks an OutboundPaymentQuote FX rate for five
 * minutes (fx_quote.lock_expires_at / lock_status). Stripe's published guidance
 * is to request another quote after that lock expires. Stripe does not require
 * a second buyer confirmation of that replacement. Authorized GP execution
 * refreshes inside the accepted agreement without another buyer click.
 */
export function evaluateDurableReleaseAuthorization(opts: {
  workerActorUserId?: string | null;
  buyerId: string;
  recordedActorUserId?: string | null;
  recordedAction?: string | null;
  purpose: DurableReleasePurpose;
}):
  | { ok: true; buyerId: string; action: "START_INSPECTION" | "BUYER_RELEASE_NOW" }
  | { ok: false; code: string } {
  if (opts.workerActorUserId) return { ok: false, code: "GP_WORKER_ACTOR_FORBIDDEN" };
  const authorizedBuyer = Boolean(opts.recordedActorUserId) && opts.recordedActorUserId === opts.buyerId;
  if (opts.purpose === "INSPECTION_EXPIRY") {
    if (!authorizedBuyer || opts.recordedAction !== "START_INSPECTION") {
      return { ok: false, code: "inspection_not_authorized" };
    }
    return { ok: true, buyerId: opts.buyerId, action: "START_INSPECTION" };
  }
  if (
    !authorizedBuyer ||
    (opts.recordedAction !== "START_INSPECTION" && opts.recordedAction !== "BUYER_RELEASE_NOW")
  ) {
    return { ok: false, code: "release_not_authorized" };
  }
  return {
    ok: true,
    buyerId: opts.buyerId,
    action: opts.recordedAction as "START_INSPECTION" | "BUYER_RELEASE_NOW",
  };
}

/** Deadline plus the recorded Start Inspection action. READY_TO_RELEASE is not an input. */
export function inspectionExpiryMayRelease(opts: {
  nowMs: number;
  inspectionEndsAtMs: number | null;
  authorized: boolean;
}): { ok: true } | { ok: false; code: "window_open" | "inspection_not_authorized" } {
  if (!opts.authorized) return { ok: false, code: "inspection_not_authorized" };
  if (opts.inspectionEndsAtMs == null || opts.inspectionEndsAtMs > opts.nowMs) {
    return { ok: false, code: "window_open" };
  }
  return { ok: true };
}

/**
 * START_INSPECTION can release only after the deadline recorded on that buyer
 * action. A missing or cleared transaction deadline does not count as expiry.
 * An earlier transaction deadline cannot release before the recorded one.
 */
export function recordedInspectionDeadlineAllowsRelease(opts: {
  nowMs: number;
  recordedEndsAtIso?: string | null;
  transactionEndsAtMs: number | null;
}): { ok: true } | { ok: false; code: "window_open" } {
  const recordedMs = Date.parse(opts.recordedEndsAtIso || "");
  const recorded = Number.isNaN(recordedMs) ? null : recordedMs;
  if (opts.transactionEndsAtMs == null) return { ok: false, code: "window_open" };
  if (recorded == null) {
    return opts.transactionEndsAtMs > opts.nowMs
      ? { ok: false, code: "window_open" }
      : { ok: true };
  }
  const deadline = Math.max(recorded, opts.transactionEndsAtMs);
  if (deadline > opts.nowMs) return { ok: false, code: "window_open" };
  return { ok: true };
}

/**
 * Quote check for an already-authorized GP payout (buyer-present or background).
 * A matching unexpired quote is used as stored. An expired or missing quote may
 * be created/refreshed only before any payment submission. Term changes are
 * refused. This function does not compare anyone to confirmedByUserId.
 */
export function evaluateBackgroundQuote(opts: {
  stored: QuoteConfirmationSnapshot | null;
  mode?: "TEST" | "LIVE";
  transactionId: string;
  recipientId: string;
  payoutMethodId: string;
  sourceAmountMinor: number;
  sourceCurrency: string;
  destinationCurrency: string;
  termsHash: string;
  nowMs: number;
  allowRefresh: boolean;
}):
  | { ok: true; action: "use"; quoteId: string }
  | { ok: true; action: "refresh" }
  | { ok: false; code: string } {
  const stored = opts.stored;
  const source = opts.sourceCurrency.toLowerCase();
  const destination = opts.destinationCurrency.toLowerCase();
  const mode = opts.mode || "LIVE";
  if (stored?.quoteId) {
    const sameTerms =
      (!stored.transactionId || stored.transactionId === opts.transactionId) &&
      (!stored.mode || stored.mode === mode) &&
      (!stored.recipientId || stored.recipientId === opts.recipientId) &&
      (!stored.payoutMethodId || stored.payoutMethodId === opts.payoutMethodId) &&
      (!stored.termsHash || stored.termsHash === opts.termsHash) &&
      stored.sourceAmountMinor === opts.sourceAmountMinor &&
      stored.sourceCurrency === source &&
      stored.destinationCurrency === destination;
    if (!sameTerms) return { ok: false, code: "GP_QUOTE_MISMATCH" };
    const expiresMs = Date.parse(stored.expiresAt || "");
    const expired = !stored.expiresAt || Number.isNaN(expiresMs) || expiresMs <= opts.nowMs;
    if (!expired) {
      if (!Number.isInteger(stored.destinationAmountMinor) || (stored.destinationAmountMinor ?? 0) <= 0) {
        return { ok: false, code: "GP_QUOTE_MISMATCH" };
      }
      return { ok: true, action: "use", quoteId: stored.quoteId };
    }
    if (!opts.allowRefresh) return { ok: false, code: "GP_QUOTE_EXPIRED" };
    return { ok: true, action: "refresh" };
  }
  if (!opts.allowRefresh) return { ok: false, code: "GP_QUOTE_EXPIRED" };
  return { ok: true, action: "refresh" };
}

/**
 * LIVE proceeds funding and outbound initiation stay behind live initiation
 * AND the named-pilot transaction/currency. TEST only needs sandbox initiation.
 * Missing or mismatched LIVE pilot env fails closed. This does not authorize
 * using another purchase’s reserved funds.
 */
export function evaluateLivePilotFundingScope(opts: {
  mode: "TEST" | "LIVE";
  initiationEnabled: boolean;
  transactionId: string;
  authorizedTransactionIdRaw: string;
  sourceCurrency: string;
  configuredSourceCurrencyRaw: string;
  collectionOnly?: boolean;
}): { ok: true } | { ok: false; code: string } {
  if (opts.collectionOnly) return { ok: false, code: "GP_COLLECTION_ONLY" };
  if (!opts.initiationEnabled) {
    return {
      ok: false,
      code:
        opts.mode === "LIVE"
          ? "GLOBAL_PAYOUTS_LIVE_INITIATION_DISABLED"
          : "GLOBAL_PAYOUTS_INITIATION_DISABLED",
    };
  }
  if (opts.mode !== "LIVE") return { ok: true };
  const authorizedTxn = parsePilotTransactionId(opts.authorizedTransactionIdRaw);
  if (!authorizedTxn || authorizedTxn !== opts.transactionId) {
    return { ok: false, code: "GP_PILOT_TRANSACTION_NOT_AUTHORIZED" };
  }
  const configuredCurrency = parsePilotSourceCurrency(opts.configuredSourceCurrencyRaw);
  const sourceCurrency = parsePilotSourceCurrency(opts.sourceCurrency);
  if (!configuredCurrency || !sourceCurrency || configuredCurrency !== sourceCurrency) {
    return { ok: false, code: "GP_PILOT_SOURCE_CURRENCY_INVALID" };
  }
  return { ok: true };
}

export function planQuotePreparation(opts: {
  mode: "TEST" | "LIVE";
  initiationEnabled: boolean;
  requiresQuote: boolean;
  collectionOnly?: boolean;
}): { ok: true; paymentPath: false; quotePath: boolean } | { ok: false; code: string } {
  if (opts.collectionOnly) return { ok: false, code: "GP_COLLECTION_ONLY" };
  if (!opts.initiationEnabled) {
    return { ok: false, code: "GLOBAL_PAYOUTS_INITIATION_DISABLED" };
  }
  return { ok: true, paymentPath: false, quotePath: opts.requiresQuote };
}

/** Reconciliation follows the master flag. Initiation off does not stop it. */
export function globalPayoutsReconciliationAllowed(opts: {
  masterEnabled: boolean;
  liveInitiationEnabled: boolean;
}): boolean {
  void opts.liveInitiationEnabled;
  return opts.masterEnabled;
}

export function pilotAppliesToRail(rail: string): boolean {
  return String(rail || "").trim().toUpperCase() === "STRIPE_GLOBAL_PAYOUTS";
}
