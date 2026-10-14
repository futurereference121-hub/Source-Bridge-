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
  durablyCreditedMinor: number;
  outboundStatuses: readonly string[];
  pendingTransferMinor: number;
  pendingFundingMinor: number;
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
  if (input.bankInformation === "unavailable") return none("BANK_INFORMATION_UNAVAILABLE");
  if (!input.destinationReady) return none("BANK_DESTINATION_UNVERIFIED");
  if (input.uncertainBankAttempt) return none("BANK_PAYOUT_UNCERTAIN");
  if (input.availableMinor == null || !whole(input.availableMinor)) return none("BALANCE_UNREAD");
  if (!whole(input.inflightBankMinor)) return none("GP_RESERVE_UNKNOWN");

  let gp = 0;
  let connect = 0;
  let refund = 0;
  let inflightTransfer = 0;
  let inflightFunding = 0;
  const currency = input.currency.trim().toUpperCase();
  for (const purchase of input.purchases) {
    if (purchase.stripeMode !== input.mode) continue;
    if (purchase.currency.trim().toUpperCase() !== currency) return none("GP_RESERVE_UNKNOWN");
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
  if (input.bankInformation === "unavailable") return blocked("BANK_INFORMATION_UNAVAILABLE");
  if (!input.destinationReady) return blocked("BANK_DESTINATION_UNVERIFIED");
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
