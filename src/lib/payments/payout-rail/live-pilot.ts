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

/**
 * TEST: an empty user allowlist stays an open ramp behind the country gate.
 * LIVE: an empty list, a wildcard, or any invalid entry denies everyone.
 */
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
  if (opts.actorUserId !== opts.buyerId || !opts.actorUserId) {
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

export function planQuotePreparation(opts: {
  mode: "TEST" | "LIVE";
  initiationEnabled: boolean;
  requiresQuote: boolean;
}): { ok: true; paymentPath: false; quotePath: boolean } | { ok: false; code: string } {
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
