/**
 * Decide how much of one Stripe balance may be paid to the platform bank.
 *
 * A daily automatic payout can take the available balance between any read and
 * a funding request. A database lock does not include that scheduler. Funding
 * and bank payouts therefore run only while the platform schedule is manual,
 * and only after this planner has reserved:
 * - Global Payouts charge nets that are not yet finished (including quote-fee headroom)
 * - Connect seller amounts still on the platform
 * - refund and dispute amounts
 * - pending or uncertain movements
 *
 * This module does not read or write Stripe, and it does not change a schedule.
 */

import {
  automaticBankPayoutBlocksFunding,
  completedPurchaseBlocksNewFunding,
  STRIPE_IDEMPOTENCY_WINDOW_MS,
} from "./proceeds-funding.ts";
import { connectSettlementTransferMinor } from "./connect-settlement-amount.ts";
import { idHash8 } from "./proceeds-preflight-shape.ts";

export const PLATFORM_BALANCE_LOCK_STALE_MS = 15 * 60 * 1000;
export const PLATFORM_BALANCE_STALL_MS = 30 * 60 * 1000;
export const PLATFORM_BALANCE_RESERVE_SCAN_CAP = 500;

export function bankRemainderIdempotencyKey(
  mode: string,
  currency: string,
  sequence: number,
): string {
  return `platform_bank_${mode.trim().toLowerCase()}_${currency.trim().toLowerCase()}_${sequence}`;
}

export function lockAcquisition(opts: {
  nowMs: number;
  lockedAtMs: number | null;
  staleMs?: number;
}): "acquire" | "busy" {
  if (opts.lockedAtMs == null) return "acquire";
  const staleMs = opts.staleMs ?? PLATFORM_BALANCE_LOCK_STALE_MS;
  if (opts.nowMs - opts.lockedAtMs >= staleMs) return "acquire";
  return "busy";
}

export function platformBalanceHealth(opts: {
  nowMs: number;
  enabled: boolean;
  lockedAtMs: number | null;
  lastSuccessAtMs: number | null;
}): { stalled: boolean; code: string } {
  const lockedAt = opts.lockedAtMs;
  if (lockedAt != null && opts.nowMs - lockedAt >= PLATFORM_BALANCE_LOCK_STALE_MS) {
    return { stalled: true, code: "PLATFORM_BALANCE_STALE_LOCK" };
  }
  if (!opts.enabled) return { stalled: false, code: "" };
  if (opts.lastSuccessAtMs == null || opts.nowMs - opts.lastSuccessAtMs >= PLATFORM_BALANCE_STALL_MS) {
    return { stalled: true, code: "PLATFORM_BALANCE_STALLED" };
  }
  return { stalled: false, code: "" };
}

export type ExternalBankAccount = {
  id: string;
  object: string;
  currency: string;
  defaultForCurrency: boolean;
  status: string;
  /** Null when the bank object has no livemode. The secret key already selected the mode. */
  livemode: boolean | null;
};

/** Safe fields from a Stripe error. Messages, keys, and account details are dropped. */
export function classifyStripeReadFailure(err: unknown): {
  httpStatus: number | null;
  stripeCode: string | null;
  stripeType: string | null;
  requestId: string | null;
} {
  const row = err && typeof err === "object" ? (err as Record<string, unknown>) : {};
  const httpStatus =
    typeof row.statusCode === "number" && row.statusCode >= 100 && row.statusCode <= 599
      ? row.statusCode
      : null;
  const stripeCode =
    typeof row.code === "string" && /^[a-z0-9_]+$/.test(row.code) ? row.code : null;
  const stripeType =
    typeof row.type === "string" && /^[a-z0-9_]+$/.test(row.type) ? row.type : null;
  const requestId =
    typeof row.requestId === "string" && /^req_[A-Za-z0-9]+$/.test(row.requestId)
      ? row.requestId
      : null;
  return { httpStatus, stripeCode, stripeType, requestId };
}

/**
 * Banks embedded on GET /v1/account. This is the platform's own account.
 * The connected-account list /v1/accounts/{id}/external_accounts is not used.
 */
export function readPlatformExternalAccounts(account: {
  external_accounts?: { data?: readonly unknown[]; has_more?: boolean } | null;
}):
  | { ok: true; accounts: ExternalBankAccount[]; hasMore: boolean }
  | { ok: false; code: "platform_external_accounts_absent" } {
  const list = account.external_accounts;
  if (!list || !Array.isArray(list.data)) {
    return { ok: false, code: "platform_external_accounts_absent" };
  }
  const accounts = list.data.map((row) => {
    const bank = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    return {
      id: typeof bank.id === "string" ? bank.id : "",
      object: typeof bank.object === "string" ? bank.object : "",
      currency: typeof bank.currency === "string" ? bank.currency : "",
      defaultForCurrency: bank.default_for_currency === true,
      status: typeof bank.status === "string" ? bank.status : "",
      livemode: typeof bank.livemode === "boolean" ? bank.livemode : null,
    };
  });
  return { ok: true, accounts, hasMore: list.has_more === true };
}

/**
 * Create Payout for API version 2025-08-27.basil: destination is optional.
 * When it is omitted, Stripe uses the default external account for the currency.
 * That routing rule does not prove this account's bank was returned or checked.
 */
export const PLATFORM_DEFAULT_DESTINATION_ROUTING = "supported" as const;

/** Dashboard evidence is not a Stripe API bank verification. */
export const DASHBOARD_BANK_CONFIRMATION_EVIDENCE = "DASHBOARD" as const;
export const DASHBOARD_BANK_CONFIRMATION_ACCOUNT_SUFFIX = "MV9g";
export const DASHBOARD_BANK_CONFIRMATION_STATEMENT =
  "Stripe Dashboard Test mode shows one default GBP payments-balance bank for this platform account. No USD bank is shown.";

/** A recorded Dashboard statement counts only for the TEST GBP account. It never clears USD. */
export function dashboardConfirmationApplies(input: {
  mode: string;
  currency: string;
  dashboardConfirmation?: "recorded" | "absent";
}): boolean {
  return (
    input.dashboardConfirmation === "recorded" &&
    input.mode === "TEST" &&
    input.currency.trim().toUpperCase() === "GBP"
  );
}

export function dashboardBankConfirmationMatches(input: {
  stripeMode: string;
  currency: string;
  accountSuffix: string;
  livemode: boolean;
  evidence: string;
  recordedAccountHash: string;
  currentAccountHash: string;
}): boolean {
  return (
    input.stripeMode === "TEST" &&
    input.currency.trim().toUpperCase() === "GBP" &&
    input.livemode === false &&
    input.evidence === DASHBOARD_BANK_CONFIRMATION_EVIDENCE &&
    input.accountSuffix === DASHBOARD_BANK_CONFIRMATION_ACCOUNT_SUFFIX &&
    /^[a-f0-9]{8}$/.test(input.recordedAccountHash) &&
    input.recordedAccountHash === input.currentAccountHash
  );
}

/**
 * TEST platform confirmation identity.
 * Mode comes from the selected TEST client plus a mode-bearing object (Balance).
 * Account identity is checked separately. A missing Account.livemode is allowed.
 */
export function assessTestPlatformAccount(input: {
  stripeMode: string;
  accountId: string;
  accountLivemode: boolean | null;
  modeEvidenceLivemode: boolean | null;
  expectedSuffix?: string;
}):
  | { ok: true; suffix: string; hash8: string }
  | { ok: false; code: string } {
  if (input.stripeMode !== "TEST") return { ok: false, code: "TEST_MODE_REQUIRED" };
  if (input.modeEvidenceLivemode !== false) return { ok: false, code: "TEST_MODE_EVIDENCE_MISSING" };
  if (input.accountLivemode === true) return { ok: false, code: "LIVE_ACCOUNT_OBJECT" };
  const id = input.accountId.trim();
  if (!id) return { ok: false, code: "ACCOUNT_ID_MISSING" };
  const suffix = id.slice(-4);
  const hash8 = idHash8(id);
  const expected = input.expectedSuffix ?? DASHBOARD_BANK_CONFIRMATION_ACCOUNT_SUFFIX;
  if (suffix !== expected) return { ok: false, code: "ACCOUNT_IDENTITY_MISMATCH" };
  return { ok: true, suffix, hash8 };
}

export type PlatformBankInformation = "unavailable" | "verified" | "unverified";

export function assessPlatformBank(
  embedded: ReturnType<typeof readPlatformExternalAccounts>,
  opts: { currency: string; livemode: boolean },
): {
  defaultDestinationRouting: typeof PLATFORM_DEFAULT_DESTINATION_ROUTING;
  bankConfigurationVerified: boolean;
  bankInformation: PlatformBankInformation;
  code: string;
} {
  const routing = { defaultDestinationRouting: PLATFORM_DEFAULT_DESTINATION_ROUTING };
  if (!embedded.ok) {
    return {
      ...routing,
      bankConfigurationVerified: false,
      bankInformation: "unavailable",
      code: "BANK_INFORMATION_UNAVAILABLE",
    };
  }
  const selected = selectVerifiedPlatformBank(embedded.accounts, {
    currency: opts.currency,
    livemode: opts.livemode,
    hasMore: embedded.hasMore,
  });
  if (!selected.ok) {
    return {
      ...routing,
      bankConfigurationVerified: false,
      bankInformation: "unverified",
      code: selected.code,
    };
  }
  return {
    ...routing,
    bankConfigurationVerified: true,
    bankInformation: "verified",
    code: "BANK_DESTINATION_READY",
  };
}

/**
 * The platform bank is the single default external account Stripe already uses
 * for this currency. External-account status `new` is the normal payout state.
 * `errored` and `verification_failed` are not. No caller-supplied destination
 * is accepted. Cards and financial accounts are not a bank payout.
 */
export function selectVerifiedPlatformBank(
  accounts: readonly ExternalBankAccount[],
  opts: { currency: string; livemode: boolean; hasMore: boolean },
): { ok: true; destinationId: string } | { ok: false; code: string } {
  if (opts.hasMore) return { ok: false, code: "BANK_DESTINATION_UNVERIFIED" };
  const currency = opts.currency.trim().toLowerCase();
  const matched = accounts.filter((account) => {
    const status = account.status.trim().toLowerCase();
    return (
      account.object === "bank_account" &&
      Boolean(account.id) &&
      account.currency.trim().toLowerCase() === currency &&
      account.defaultForCurrency === true &&
      (account.livemode == null || account.livemode === opts.livemode) &&
      (status === "new" || status === "verified" || status === "validated")
    );
  });
  if (matched.length !== 1) return { ok: false, code: "BANK_DESTINATION_UNVERIFIED" };
  return { ok: true, destinationId: matched[0].id };
}

export type PurchaseLiability = {
  stripeMode: "TEST" | "LIVE";
  currency: string;
  payoutRail: string;
  paymentOption: string;
  status: string;
  sellerEntitlementMinor: number;
  transferredMinor: number;
  protectionFeeMinor: number;
  platformFeeRefundedMinor: number;
  totalChargeMinor: number;
  refundedMinor: number;
  openDispute: boolean;
  /** Null until the charge balance transaction has been read. Zero is a real net. */
  chargeNetMinor: number | null;
  /**
   * Currency of the charge's balance transaction. Purchase currency is not a substitute.
   * Null means the settlement currency has not been stored.
   */
  settlementCurrency?: string | null;
  /** Charge gross in purchase currency, from that charge. Not an exchange rate. */
  chargeAmountMinor?: number | null;
  /** Balance-transaction gross in settlement currency, from that same charge. */
  balanceTransactionAmountMinor?: number | null;
  /** Set when the outstanding charge could not be reserved. Zero is not a reserve. */
  settlementBlockCode?: string | null;
  durablyCreditedMinor: number;
  outboundStatuses: readonly string[];
  pendingTransferMinor: number;
  pendingFundingMinor: number;
  /** First 8 hex characters of the purchase id. Never a raw id. */
  purchaseHash?: string;
};

export type PurchaseReserve = {
  gpMinor: number;
  connectMinor: number;
  refundMinor: number;
  inflightTransferMinor: number;
  inflightFundingMinor: number;
  blockedCode: string;
};

function whole(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

/**
 * Settlement-currency amount of the Connect transfer for this presentment
 * remainder. It uses the release path's own gross figures and rounding.
 * It is not an exchange rate and it is not a presentment-currency payment.
 */
export function connectReleaseSettlementMinor(input: {
  presentmentMinor: number;
  chargeAmountMinor: number | null;
  balanceTransactionAmountMinor: number | null;
}): number | null {
  if (!whole(input.presentmentMinor)) return null;
  if (input.presentmentMinor === 0) return 0;
  const chargeAmount = input.chargeAmountMinor;
  const settledAmount = input.balanceTransactionAmountMinor;
  if (chargeAmount == null || settledAmount == null || !whole(chargeAmount) || !whole(settledAmount) || chargeAmount <= 0) {
    return null;
  }
  return connectSettlementTransferMinor(input.presentmentMinor, chargeAmount, settledAmount);
}

/** Available and pending stay separate. A missing amount stays null, not zero. */
export function listedBalanceAmounts(
  entries: readonly { currency?: string | null; amount?: number | null }[] | null | undefined,
): { currency: string; amountMinor: number | null }[] {
  const amounts = [];
  for (const entry of entries ?? []) {
    const currency = typeof entry.currency === "string" ? entry.currency.trim().toUpperCase() : "";
    if (!/^[A-Z]{3}$/.test(currency)) continue;
    amounts.push({
      currency,
      amountMinor: typeof entry.amount === "number" && Number.isInteger(entry.amount) ? entry.amount : null,
    });
  }
  return amounts;
}

/** A balance entry counts even when its amount is zero or absent. */
export function listedBalanceCurrencies(
  entries: readonly { currency?: string | null; amount?: number | null }[],
): string[] {
  const currencies: string[] = [];
  for (const entry of entries) {
    if (typeof entry.currency === "string" && entry.currency.trim()) currencies.push(entry.currency);
  }
  return currencies;
}

/** Settlement currencies of open obligations. Purchase price is not a substitute. */
export function settlementLiabilityCurrencies(
  purchases: readonly PurchaseLiability[],
  mode: "TEST" | "LIVE",
): string[] {
  const currencies: string[] = [];
  for (const purchase of purchases) {
    if (purchase.stripeMode !== mode || purchase.settlementBlockCode) continue;
    const reserved = reservePurchase(purchase);
    const open =
      reserved.gpMinor > 0 ||
      reserved.connectMinor > 0 ||
      reserved.refundMinor > 0 ||
      purchase.pendingTransferMinor > 0 ||
      purchase.pendingFundingMinor > 0;
    if (!open) continue;
    const settlement = (purchase.settlementCurrency ?? "").trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(settlement)) {
      currencies.push(settlement);
      continue;
    }
    if (purchase.payoutRail === "STRIPE_GLOBAL_PAYOUTS") {
      const currency = purchase.currency.trim().toUpperCase();
      if (/^[A-Z]{3}$/.test(currency)) currencies.push(currency);
    }
  }
  return currencies;
}

export type OutstandingConnectReserve = {
  purchaseHash: string;
  purchaseCurrency: string;
  settlementCurrency: string | null;
  presentmentRemainderMinor: number | null;
  reserveCurrency: string | null;
  reserveMinor: number | null;
  reserveCode: string | null;
  readOk: boolean;
  readCode: string | null;
};

/** Outstanding Connect reserves. Hashes only. An unknown reserve is null, not zero. */
export function outstandingConnectReserves(
  purchases: readonly PurchaseLiability[],
  mode: "TEST" | "LIVE",
): OutstandingConnectReserve[] {
  const rows: OutstandingConnectReserve[] = [];
  for (const purchase of purchases) {
    if (purchase.stripeMode !== mode || purchase.payoutRail !== "STRIPE_CONNECT") continue;
    const reserved = reservePurchase(purchase);
    const outstanding =
      purchase.pendingTransferMinor > 0 ||
      purchase.pendingFundingMinor > 0 ||
      Boolean(purchase.settlementBlockCode) ||
      (!reserved.blockedCode && (reserved.connectMinor > 0 || reserved.refundMinor > 0));
    if (!outstanding) continue;
    const purchaseHash = (purchase.purchaseHash ?? "").trim().toLowerCase();
    const settlement = (purchase.settlementCurrency ?? "").trim().toUpperCase();
    const settlementCurrency = /^[A-Z]{3}$/.test(settlement) ? settlement : null;
    let reserveMinor: number | null = null;
    let reserveCode: string | null = purchase.settlementBlockCode || reserved.blockedCode || null;
    if (!reserveCode && settlementCurrency) {
      if (purchase.currency.trim().toUpperCase() === settlementCurrency) {
        reserveMinor = reserved.connectMinor + reserved.refundMinor;
      } else {
        const cross = classifyCrossCurrencyReserve(purchase, settlementCurrency);
        if (cross.code) reserveCode = cross.code;
        else reserveMinor = cross.minor;
      }
    } else if (!reserveCode) {
      reserveCode = "SETTLEMENT_CURRENCY_UNKNOWN";
    }
    if (purchase.pendingTransferMinor > 0 || purchase.pendingFundingMinor > 0) {
      reserveCode = "UNRESOLVED_MOVEMENT";
      reserveMinor = null;
    }
    rows.push({
      purchaseHash: /^[a-f0-9]{8}$/.test(purchaseHash) ? purchaseHash : "",
      purchaseCurrency: purchase.currency.trim().toUpperCase(),
      settlementCurrency,
      presentmentRemainderMinor: reserved.blockedCode ? null : reserved.connectMinor,
      reserveCurrency: reserveMinor == null ? null : settlementCurrency,
      reserveMinor,
      reserveCode,
      readOk: !purchase.settlementBlockCode && settlementCurrency != null,
      readCode: purchase.settlementBlockCode || null,
    });
  }
  return rows;
}

/** Bank currencies come from settlement balances and known settlement currencies. */
export function bankCurrencies(input: {
  balanceCurrencies: readonly string[];
  settlementCurrencies?: readonly string[];
  openAttemptCurrencies?: readonly string[];
}): string[] {
  const currencies = new Set<string>();
  for (const value of [
    ...input.balanceCurrencies,
    ...(input.settlementCurrencies ?? []),
    ...(input.openAttemptCurrencies ?? []),
  ]) {
    const currency = value.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(currency)) currencies.add(currency);
  }
  return [...currencies];
}

/**
 * A purchase priced in another currency is not subtracted from this bank currency.
 * Outstanding seller or refund amounts block until the charge's own settlement
 * gross can price them. Purchase currency alone does not invent a bank.
 */
export function classifyCrossCurrencyReserve(
  purchase: PurchaseLiability,
  bankCurrency: string,
): { code: string | null; minor: number } {
  const purchaseCurrency = purchase.currency.trim().toUpperCase();
  const bank = bankCurrency.trim().toUpperCase();
  if (purchase.settlementBlockCode) return { code: purchase.settlementBlockCode, minor: 0 };
  if (purchaseCurrency === bank) return { code: null, minor: 0 };
  const reserved = reservePurchase(purchase);
  if (reserved.blockedCode) return { code: reserved.blockedCode, minor: 0 };
  const openSeller = reserved.connectMinor > 0;
  const openRefund = reserved.refundMinor > 0;
  const openGp = reserved.gpMinor > 0;
  if (!openSeller && !openRefund && !openGp) return { code: null, minor: 0 };
  const settlement = (purchase.settlementCurrency ?? "").trim().toUpperCase();
  if (!settlement) return { code: "SETTLEMENT_CURRENCY_UNKNOWN", minor: 0 };
  if (settlement !== bank) return { code: null, minor: 0 };
  if (openRefund || openGp) return { code: "SETTLEMENT_RESERVE_UNRESOLVED", minor: 0 };
  const converted = connectReleaseSettlementMinor({
    presentmentMinor: reserved.connectMinor,
    chargeAmountMinor: purchase.chargeAmountMinor ?? null,
    balanceTransactionAmountMinor: purchase.balanceTransactionAmountMinor ?? null,
  });
  if (converted == null) return { code: "SETTLEMENT_RESERVE_UNRESOLVED", minor: 0 };
  return { code: null, minor: converted };
}

/** First cross-currency obligation that cannot be reserved against this bank currency. */
export function settlementBlockForCurrency(
  purchases: readonly PurchaseLiability[],
  bankCurrency: string,
  mode: "TEST" | "LIVE",
): string | null {
  for (const purchase of purchases) {
    if (purchase.stripeMode !== mode) continue;
    if (purchase.settlementBlockCode) return purchase.settlementBlockCode;
    if (purchase.currency.trim().toUpperCase() === bankCurrency.trim().toUpperCase()) continue;
    if (purchase.pendingTransferMinor > 0 || purchase.pendingFundingMinor > 0) return "UNRESOLVED_MOVEMENT";
    const cross = classifyCrossCurrencyReserve(purchase, bankCurrency);
    if (cross.code) return cross.code;
  }
  return null;
}

/**
 * Reserve the unpaid charge net, not the current quote. A later quote can be
 * higher until the seller payout is finished, so the fee headroom stays here.
 */
export function reservePurchase(row: PurchaseLiability): PurchaseReserve {
  const empty = {
    gpMinor: 0,
    connectMinor: 0,
    refundMinor: 0,
    inflightTransferMinor: 0,
    inflightFundingMinor: 0,
    blockedCode: "",
  };
  const pendingTransfer = row.pendingTransferMinor;
  const pendingFunding = row.pendingFundingMinor;
  if (!whole(pendingTransfer) || !whole(pendingFunding)) {
    return { ...empty, blockedCode: "GP_RESERVE_UNKNOWN" };
  }
  if (["REFUNDED", "CANCELLED", "FAILED"].includes(row.status)) {
    return { ...empty, inflightTransferMinor: pendingTransfer, inflightFundingMinor: pendingFunding };
  }
  const rail = row.payoutRail;
  const completed = completedPurchaseBlocksNewFunding({
    txnStatus: row.status,
    outboundStatuses: row.outboundStatuses,
  });
  const disputed =
    row.openDispute || row.status === "DISPUTED" || row.status === "PARTIALLY_REFUNDED";

  if (rail === "STRIPE_GLOBAL_PAYOUTS") {
    if (completed && !disputed) {
      return { ...empty, inflightTransferMinor: pendingTransfer, inflightFundingMinor: pendingFunding };
    }
    if (row.chargeNetMinor == null || !whole(row.chargeNetMinor) || !whole(row.durablyCreditedMinor)) {
      return { ...empty, blockedCode: "GP_RESERVE_UNKNOWN" };
    }
    if (row.durablyCreditedMinor > row.chargeNetMinor) {
      return { ...empty, blockedCode: "GP_FUNDING_OVER_CHARGE" };
    }
    return {
      ...empty,
      gpMinor: row.chargeNetMinor - row.durablyCreditedMinor,
      inflightTransferMinor: pendingTransfer,
      inflightFundingMinor: pendingFunding,
    };
  }

  if (!whole(row.sellerEntitlementMinor) || !whole(row.transferredMinor)) {
    return { ...empty, blockedCode: "GP_RESERVE_UNKNOWN" };
  }
  const connectMinor =
    row.paymentOption === "INSTANT" ? 0 : Math.max(0, row.sellerEntitlementMinor - row.transferredMinor);
  let refundMinor = 0;
  if (disputed) {
    if (row.paymentOption === "INSTANT") {
      if (!whole(row.protectionFeeMinor) || !whole(row.platformFeeRefundedMinor)) {
        return { ...empty, blockedCode: "GP_RESERVE_UNKNOWN" };
      }
      refundMinor = Math.max(0, row.protectionFeeMinor - row.platformFeeRefundedMinor);
    } else {
      if (!whole(row.totalChargeMinor) || !whole(row.refundedMinor)) {
        return { ...empty, blockedCode: "GP_RESERVE_UNKNOWN" };
      }
      const platformHeld = Math.max(0, row.totalChargeMinor - row.refundedMinor - row.transferredMinor);
      refundMinor = Math.max(0, platformHeld - connectMinor);
    }
  }
  return {
    gpMinor: 0,
    connectMinor,
    refundMinor,
    inflightTransferMinor: pendingTransfer,
    inflightFundingMinor: pendingFunding,
    blockedCode: "",
  };
}

export type BankRemainderPlan = {
  amountMinor: number;
  reservedMinor: number;
  code: string;
};

/**
 * Pay the bank only what is left after reserves. Pending funding and transfers
 * that are already inside a reserve are not subtracted twice. Anything uncertain
 * or unreadable pays nothing.
 */
export function planSafeBankRemainder(input: {
  mode: "TEST" | "LIVE";
  currency: string;
  bankEnabled: boolean;
  scheduleInterval: string | null;
  availableMinor: number | null;
  destinationReady: boolean;
  uncertainBankAttempt: boolean;
  /** In-flight provider debits whose result is not in the books yet. Any positive count blocks the payout. */
  unresolvedMovements?: number;
  /** False when a balance, account, or liability read failed. An omitted bank list is not a failed read. */
  providerReadOk?: boolean;
  /** Omitted bank data stays unpaid without being treated as a failed provider read. */
  bankInformation?: "unavailable" | "verified" | "unverified";
  /** Dashboard confirmation for this exact account. It is not API verification. */
  dashboardConfirmation?: "recorded" | "absent";
  inflightBankMinor: number;
  purchases: readonly PurchaseLiability[];
  scanComplete: boolean;
}): BankRemainderPlan {
  const none = (code: string, reservedMinor = 0): BankRemainderPlan => ({
    amountMinor: 0,
    reservedMinor,
    code,
  });
  if (!input.bankEnabled) return none("BANK_REMAINDER_DISABLED");
  const schedule = automaticBankPayoutBlocksFunding(input.scheduleInterval);
  if (schedule.blocked) return none(schedule.code);
  if (!input.scanComplete) return none("GP_RESERVE_UNKNOWN");
  if (input.providerReadOk === false) return none("PROVIDER_READ_FAILED");
  if ((input.unresolvedMovements ?? 0) > 0) return none("UNRESOLVED_MOVEMENT");

  let gp = 0;
  let connect = 0;
  let refund = 0;
  let inflightTransfer = 0;
  let inflightFunding = 0;
  const currency = input.currency.trim().toUpperCase();
  for (const purchase of input.purchases) {
    if (purchase.stripeMode !== input.mode) continue;
    if (purchase.settlementBlockCode) return none(purchase.settlementBlockCode);
    if (purchase.currency.trim().toUpperCase() !== currency) {
      if (purchase.pendingTransferMinor > 0 || purchase.pendingFundingMinor > 0) {
        return none("UNRESOLVED_MOVEMENT");
      }
      const cross = classifyCrossCurrencyReserve(purchase, currency);
      if (cross.code) return none(cross.code);
      connect += cross.minor;
      continue;
    }
    if (purchase.pendingTransferMinor > 0 || purchase.pendingFundingMinor > 0) {
      return none("UNRESOLVED_MOVEMENT");
    }
    const reserved = reservePurchase(purchase);
    if (reserved.blockedCode) return none(reserved.blockedCode);
    gp += reserved.gpMinor;
    connect += reserved.connectMinor;
    refund += reserved.refundMinor;
    inflightTransfer += reserved.inflightTransferMinor;
    inflightFunding += reserved.inflightFundingMinor;
  }
  if (input.bankInformation === "unavailable" && !dashboardConfirmationApplies(input)) {
    return none("BANK_INFORMATION_UNAVAILABLE");
  }
  if (input.bankInformation !== "unavailable" && !input.destinationReady) {
    return none("BANK_DESTINATION_UNVERIFIED");
  }
  if (input.uncertainBankAttempt) return none("BANK_PAYOUT_UNCERTAIN");
  if (input.availableMinor == null || !whole(input.availableMinor)) return none("BALANCE_UNREAD");
  if (!whole(input.inflightBankMinor)) return none("GP_RESERVE_UNKNOWN");
  const extraInflight =
    input.inflightBankMinor +
    Math.max(0, inflightTransfer - connect) +
    Math.max(0, inflightFunding - gp);
  const reservedMinor = gp + connect + refund + extraInflight;
  if (reservedMinor > input.availableMinor) return none("BANK_REMAINDER_NONE", reservedMinor);
  const amountMinor = input.availableMinor - reservedMinor;
  if (amountMinor === 0) return none("BANK_REMAINDER_NONE", reservedMinor);
  return { amountMinor, reservedMinor, code: "BANK_REMAINDER_PAY" };
}

export type LockOwner = { token: string; fence: number };

/** A stolen lock has a new token and a higher fence. The old worker must not write. */
export function maySubmitProviderWrite(held: LockOwner | null, current: LockOwner | null): boolean {
  if (!held || !current) return false;
  if (!held.token || held.fence <= 0) return false;
  return held.token === current.token && held.fence === current.fence;
}

/**
 * The original worker calls this after a pause. The write runs only if it still owns the lock.
 */
export async function resumeWorkerAfterTakeover<T>(opts: {
  held: LockOwner;
  readCurrent: () => Promise<LockOwner | null> | LockOwner | null;
  write: () => Promise<T>;
}): Promise<{ submitted: false; code: "LOCK_FENCE_LOST" } | { submitted: true; value: T }> {
  const current = await opts.readCurrent();
  if (!maySubmitProviderWrite(opts.held, current)) return { submitted: false, code: "LOCK_FENCE_LOST" };
  const value = await opts.write();
  return { submitted: true, value };
}

/**
 * Application code cannot stop a schedule edit made in the Stripe Dashboard.
 * Readiness can be true while the schedule is still daily. Paying out still requires manual.
 */
export const DASHBOARD_SCHEDULE_LIMIT =
  "Application checks cannot stop a payout-schedule change made in the Stripe Dashboard.";

export type ModeReadiness = {
  mode: "TEST" | "LIVE";
  ready: boolean;
  payoutsAllowed: boolean;
  code: string;
};

export function evaluateModeReadiness(input: {
  mode: "TEST" | "LIVE";
  scheduleInterval: string | null;
  destinationReady: boolean;
  providerReadsOk: boolean;
  liabilitiesReadable: boolean;
  unresolvedMovements: number;
  priorReadinessPass: boolean;
  moneyMovementEnabled: boolean;
  bankInformation?: "unavailable" | "verified" | "unverified";
  dashboardConfirmation?: "recorded" | "absent";
  currency?: string;
  /** Set when an open obligation cannot be reserved in this bank currency. */
  settlementCode?: string | null;
}): ModeReadiness {
  const blocked = (code: string): ModeReadiness => ({
    mode: input.mode,
    ready: false,
    payoutsAllowed: false,
    code,
  });
  if (!input.providerReadsOk) return blocked("PROVIDER_READ_FAILED");
  if (!input.liabilitiesReadable) return blocked("GP_RESERVE_UNKNOWN");
  if (input.unresolvedMovements > 0) return blocked("UNRESOLVED_MOVEMENT");
  if (input.settlementCode) return blocked(input.settlementCode);
  if (
    input.bankInformation === "unavailable" &&
    !dashboardConfirmationApplies({
      mode: input.mode,
      currency: input.currency ?? "",
      dashboardConfirmation: input.dashboardConfirmation,
    })
  ) {
    return blocked("BANK_INFORMATION_UNAVAILABLE");
  }
  if (input.bankInformation !== "unavailable" && !input.destinationReady) {
    return blocked("BANK_DESTINATION_UNVERIFIED");
  }
  if (!input.priorReadinessPass) return blocked("CUTOVER_WARMUP");
  const schedule = automaticBankPayoutBlocksFunding(input.scheduleInterval);
  return {
    mode: input.mode,
    ready: true,
    payoutsAllowed: input.moneyMovementEnabled && !schedule.blocked,
    code: schedule.blocked ? "READINESS_DAILY_SCHEDULE" : "READINESS_READY",
  };
}

export function readinessHeartbeatForMode(
  rows: readonly { stripeMode: string; readinessCheckedAt: string | null }[],
  mode: "TEST" | "LIVE",
): boolean {
  return rows.some((row) => row.stripeMode === mode && Boolean(row.readinessCheckedAt));
}

/** The shared schedule can change only when both modes have their own ready heartbeat. */
export function sharedScheduleCutover(opts: {
  test: { ready: boolean };
  live: { ready: boolean };
}): { allowed: boolean; code: string } {
  if (!opts.test.ready) return { allowed: false, code: "TEST_NOT_READY" };
  if (!opts.live.ready) return { allowed: false, code: "LIVE_NOT_READY" };
  return { allowed: true, code: "SHARED_CUTOVER_READY" };
}

export function nextBankRemainderAttempt(opts: {
  mode: string;
  currency: string;
  attempts: readonly { sequence: number; status: string }[];
}):
  | { action: "create" | "reuse"; sequence: number; idempotencyKey: string }
  | { action: "blocked"; code: string } {
  const open = opts.attempts.filter((attempt) => attempt.status === "PENDING" || attempt.status === "UNCERTAIN");
  if (open.length > 1) return { action: "blocked", code: "BANK_PAYOUT_DUPLICATE_OPEN" };
  if (open.length === 1) {
    return {
      action: "reuse",
      sequence: open[0].sequence,
      idempotencyKey: bankRemainderIdempotencyKey(opts.mode, opts.currency, open[0].sequence),
    };
  }
  const max = opts.attempts.reduce((n, attempt) => Math.max(n, attempt.sequence), 0);
  const sequence = max + 1;
  return {
    action: "create",
    sequence,
    idempotencyKey: bankRemainderIdempotencyKey(opts.mode, opts.currency, sequence),
  };
}

/**
 * The replacement bank process can be ready while the schedule is still daily.
 * Ready does not mean the schedule may be edited by this process. It means a
 * later manual change has a running remainder job, a verified bank, and no
 * unresolved bank attempt. This function does not change the schedule.
 */
export function manualScheduleCutoverDecision(opts: {
  bankRemainderEnabled: boolean;
  coordinationPresent: boolean;
  healthStalled: boolean;
  uncertainBankAttempts: number;
  currencies: readonly { currency: string; destinationReady: boolean }[];
}): { allowed: boolean; code: string } {
  if (!opts.bankRemainderEnabled) return { allowed: false, code: "BANK_REMAINDER_DISABLED" };
  if (!opts.coordinationPresent) return { allowed: false, code: "COORDINATION_MISSING" };
  if (opts.healthStalled) return { allowed: false, code: "PLATFORM_BALANCE_STALLED" };
  if (opts.uncertainBankAttempts > 0) return { allowed: false, code: "BANK_PAYOUT_UNCERTAIN" };
  if (opts.currencies.length === 0) return { allowed: false, code: "BALANCE_UNREAD" };
  if (opts.currencies.some((row) => !row.destinationReady)) {
    return { allowed: false, code: "BANK_DESTINATION_UNVERIFIED" };
  }
  return { allowed: true, code: "CUTOVER_READY" };
}

/**
 * Turning the flags off stops new payouts and leaves the money in Stripe.
 * Switching the platform schedule back to daily is a separate choice. It is
 * refused while any reserved, in-flight, or uncertain amount could still be
 * sitting in the available balance, because the automatic payout would take it.
 */
export function dailyScheduleRollbackDecision(opts: {
  gpReservedMinor: number;
  connectReservedMinor: number;
  refundReservedMinor: number;
  inflightMinor: number;
  uncertainAttempts: number;
}): { allowed: boolean; code: string } {
  const amounts = [
    opts.gpReservedMinor,
    opts.connectReservedMinor,
    opts.refundReservedMinor,
    opts.inflightMinor,
  ];
  if (amounts.some((amount) => !whole(amount)) || !whole(opts.uncertainAttempts)) {
    return { allowed: false, code: "ROLLBACK_BLOCKED_PROTECTED_FUNDS" };
  }
  if (amounts.some((amount) => amount > 0) || opts.uncertainAttempts > 0) {
    return { allowed: false, code: "ROLLBACK_BLOCKED_PROTECTED_FUNDS" };
  }
  return { allowed: true, code: "ROLLBACK_NO_PROTECTED_FUNDS" };
}

export { STRIPE_IDEMPOTENCY_WINDOW_MS };
