/**
 * Allocate settled Global Payouts card proceeds into the platform financial account.
 *
 * UK businesses can fund a GBP financial account from the available Stripe payments
 * balance with Payouts API v1: `POST /v1/payouts` and `payout_method` set to the
 * financial account id. Funds must already be available. A recurring transfer needs
 * an automatic payout schedule and does not run at the moment one charge settles,
 * and it does not identify the purchase. Inbound bank pulls are US-only.
 *
 * A `balance.available` event only says some funds became available. The charge's
 * own balance transaction decides whether this purchase has settled.
 * Global Payouts v2 stays on 2026-08-26.preview. This payout uses the Payouts v1
 * parameter already in the current API and does not change that pinned version.
 */

export const GP_PROCEEDS_FUNDING_MECHANISM = "v1_payout_to_financial_account" as const;

/** Seller outbound states that mean the purchase was already paid out. */
export const GP_COMPLETED_OUTBOUND_STATUSES = ["SUCCEEDED", "RECONCILED"] as const;

/** Stored when the platform payout schedule is unread or not manual. */
export const GP_SCHEDULE_BLOCK_CODES = [
  "GP_AUTOMATIC_BANK_PAYOUT",
  "GP_PAYOUT_SCHEDULE_UNREAD",
] as const;

export const GP_RELEASE_WAITING_COPY =
  "Release confirmed. Your sourcer\u2019s international payout will be sent automatically once your payment clears. No further action is needed.";

/** Funding is off, or the payout schedule blocks it. No internal account terms. */
export const GP_FUNDING_HOLD_COPY =
  "Release confirmed. Source Bridge is reviewing the payout. No further action is needed.";

/** Charge is available and the financial-account funding payout has not been sent. */
export const GP_FUNDING_PROGRESS_COPY =
  "Release confirmed. Your payment has cleared. Source Bridge is funding your sourcer\u2019s international payout automatically. No further action is needed.";

/** Funding payout is in progress after the charge became available. */
export const GP_FUNDING_PROCESSING_COPY =
  "Release confirmed. Your sourcer\u2019s international payout is being processed. No further action is needed.";

/** Stripe retains idempotency results for 24 hours. After that, the same key can create a new payout. */
export const STRIPE_IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

export const USUAL_CLEARING_BUSINESS_DAYS = 3;

export type GpBuyerPayoutPhase =
  | "waiting_settlement"
  | "waiting_funding"
  | "review"
  | "sending"
  | "sent"
  | "failed"
  | "returned"
  | "uncertain";

/**
 * A released purchase, or one whose seller payout already succeeded, must not
 * receive another quote or funding payout. A pending funding leg is a separate
 * question: that leg can still be reconciled.
 */
export function completedPurchaseBlocksNewFunding(opts: {
  txnStatus: string;
  outboundStatuses: readonly string[];
}): boolean {
  if (String(opts.txnStatus || "").toUpperCase() === "RELEASED") return true;
  const done = new Set<string>(GP_COMPLETED_OUTBOUND_STATUSES);
  return opts.outboundStatuses.some((status) => done.has(String(status || "").toUpperCase()));
}

export function fundingScanIncludesPurchase(opts: {
  txnStatus: string;
  outboundStatuses: readonly string[];
  hasPendingFundingLeg: boolean;
}): boolean {
  if (opts.hasPendingFundingLeg) return true;
  return !completedPurchaseBlocksNewFunding(opts);
}

export function scheduleBlocksBuyerFunding(failureCode: string | null | undefined): boolean {
  return (GP_SCHEDULE_BLOCK_CODES as readonly string[]).includes(String(failureCode || ""));
}

export type GpBuyerPayoutProgress = {
  phase: GpBuyerPayoutPhase;
  headline: string;
  timing: string;
  hideReleaseActions: boolean;
};

export type ChargeSettlementInput = {
  chargeId: string;
  livemode: boolean;
  currency: string;
  grossMinor: number;
  refundedMinor: number;
  netMinor: number;
  balanceStatus: string;
  availableOn: Date | null;
  sourceType?: string | null;
};

export type ChargeSettlement =
  | {
      ok: true;
      chargeId: string;
      currency: string;
      netMinor: number;
      available: boolean;
      availableOn: Date | null;
    }
  | { ok: false; code: string };

export type FundingLegView = {
  sequence: number;
  amountMinor: number;
  status: string;
  stripePayoutId: string;
  faCreditId: string;
  failureCode?: string;
};

export type AllocateFundingInput = {
  payoutRail: string;
  stripeMode: "TEST" | "LIVE";
  initiationAllowed: boolean;
  currency: string;
  principalMinor: number;
  payoutFeeMinor: number;
  charge: ChargeSettlement;
  postedMinor: number;
  pendingMinor: number;
  platformAvailableMinor: number;
  reservedMinor: number;
  otherInFlightMinor: number;
  txnStatus: string;
  openDispute: boolean;
  now: Date;
};

export type AllocateFundingResult =
  | { action: "wait"; status: "AWAITING_SETTLEMENT" | "SHORT" | "FUNDING"; code: string }
  | { action: "blocked"; code: string }
  | { action: "complete"; postedMinor: number }
  | { action: "fund"; amountMinor: number; code: "GP_PROCEEDS_FUND" };

const BLOCKED_TXN = new Set([
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "CANCELLED",
  "FAILED",
  "DISPUTED",
]);

export function assessChargeSettlement(
  input: ChargeSettlementInput,
  mode: "TEST" | "LIVE",
): ChargeSettlement {
  if (!input.chargeId) return { ok: false, code: "GP_CHARGE_MISSING" };
  if (input.livemode !== (mode === "LIVE")) return { ok: false, code: "GP_CHARGE_MODE_MISMATCH" };
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, code: "GP_CHARGE_CURRENCY" };
  if (!Number.isInteger(input.netMinor) || input.netMinor < 0) {
    return { ok: false, code: "GP_CHARGE_NET" };
  }
  if (!Number.isInteger(input.refundedMinor) || input.refundedMinor < 0) {
    return { ok: false, code: "GP_CHARGE_REFUND" };
  }
  if (input.refundedMinor > 0) return { ok: false, code: "GP_CHARGE_REFUNDED" };
  const status = input.balanceStatus.trim().toLowerCase();
  return {
    ok: true,
    chargeId: input.chargeId,
    currency,
    netMinor: input.netMinor,
    available: status === "available",
    availableOn: input.availableOn,
  };
}

export function allocateGpProceedsFunding(input: AllocateFundingInput): AllocateFundingResult {
  if (input.payoutRail !== "STRIPE_GLOBAL_PAYOUTS") {
    return { action: "blocked", code: "GP_FUNDING_NOT_GP" };
  }
  if (!input.initiationAllowed) return { action: "blocked", code: "GP_INITIATION_DISABLED" };
  if (input.openDispute || BLOCKED_TXN.has(input.txnStatus)) {
    return { action: "blocked", code: "GP_FUNDING_NOT_ELIGIBLE" };
  }
  if (!input.charge.ok) return { action: "blocked", code: input.charge.code };
  if (input.charge.currency !== input.currency.trim().toUpperCase()) {
    return { action: "blocked", code: "GP_FUNDING_CURRENCY" };
  }
  const principal = input.principalMinor;
  const fees = input.payoutFeeMinor;
  if (
    !Number.isInteger(principal) ||
    principal < 0 ||
    !Number.isInteger(fees) ||
    fees < 0 ||
    !Number.isInteger(input.postedMinor) ||
    input.postedMinor < 0 ||
    !Number.isInteger(input.pendingMinor) ||
    input.pendingMinor < 0
  ) {
    return { action: "blocked", code: "GP_FUNDING_AMOUNT" };
  }
  const required = principal + fees;
  if (input.postedMinor > input.charge.netMinor || input.postedMinor > required) {
    return { action: "blocked", code: "GP_FUNDING_OVER_CHARGE" };
  }
  if (input.pendingMinor > 0) return { action: "wait", status: "FUNDING", code: "GP_FUNDING_IN_FLIGHT" };
  if (input.postedMinor >= required && required > 0) {
    return { action: "complete", postedMinor: input.postedMinor };
  }
  if (!input.charge.available) {
    return { action: "wait", status: "AWAITING_SETTLEMENT", code: "GP_CHARGE_PENDING" };
  }
  if (input.charge.availableOn && input.charge.availableOn.getTime() > input.now.getTime()) {
    return { action: "wait", status: "AWAITING_SETTLEMENT", code: "GP_CHARGE_AVAILABLE_ON" };
  }
  const outstanding = required - input.postedMinor;
  const chargeRoom = input.charge.netMinor - input.postedMinor;
  const platformRoom =
    input.platformAvailableMinor - input.reservedMinor - input.otherInFlightMinor;
  if (chargeRoom < outstanding || platformRoom < outstanding) {
    return { action: "wait", status: "SHORT", code: "GP_FUNDING_ROOM" };
  }
  return { action: "fund", amountMinor: outstanding, code: "GP_PROCEEDS_FUND" };
}

export function nextFundingLegSequence(
  protectedTxnId: string,
  legs: FundingLegView[],
): {
  action: "create" | "reuse" | "wait";
  sequence: number;
  idempotencyKey: string;
} {
  const pending = legs.find((leg) => leg.status === "PENDING");
  if (pending) {
    return {
      action: pending.stripePayoutId ? "wait" : "reuse",
      sequence: pending.sequence,
      idempotencyKey: fundingIdempotencyKey(protectedTxnId, pending.sequence),
    };
  }
  const max = legs.reduce((n, leg) => Math.max(n, leg.sequence), 0);
  const latest = legs.find((leg) => leg.sequence === max);
  if (latest && latest.status !== "FAILED" && latest.status !== "CANCELLED") {
    return {
      action: "wait",
      sequence: max,
      idempotencyKey: fundingIdempotencyKey(protectedTxnId, max),
    };
  }
  if (
    latest &&
    (!latest.stripePayoutId || latest.failureCode === "GP_FUNDING_OUTCOME_UNCERTAIN")
  ) {
    return {
      action: "reuse",
      sequence: latest.sequence,
      idempotencyKey: fundingIdempotencyKey(protectedTxnId, latest.sequence),
    };
  }
  const sequence = max + 1;
  return {
    action: "create",
    sequence,
    idempotencyKey: fundingIdempotencyKey(protectedTxnId, sequence),
  };
}

export function fundingIdempotencyKey(protectedTxnId: string, sequence: number): string {
  return `gp_proceeds_${protectedTxnId}_${sequence}`;
}

type CreditLike = Record<string, unknown>;

function creditAmount(credit: CreditLike): { value: number; currency: string } | null {
  const amount = credit.amount;
  if (!amount || typeof amount !== "object") return null;
  const value = (amount as { value?: unknown }).value;
  const currency = (amount as { currency?: unknown }).currency;
  if (typeof value !== "number" || typeof currency !== "string") return null;
  return { value, currency: currency.toLowerCase() };
}

export function isSimulatedFundingCredit(credit: CreditLike): boolean {
  const blob = JSON.stringify(credit).toLowerCase();
  return blob.includes("simulated") || blob.includes("test_helper") || blob.includes("received_credit_test_helper");
}

function balanceTransferPayoutId(credit: CreditLike): string {
  const transfer = credit.balance_transfer;
  if (!transfer || typeof transfer !== "object") return "";
  const payoutId = (transfer as { payout_v1?: unknown }).payout_v1;
  return typeof payoutId === "string" ? payoutId : "";
}

/**
 * Confirm a ReceivedCredit only when Stripe's pinned v2 object says this
 * credit came from this funding payout (`type=balance_transfer` and
 * `balance_transfer.payout_v1`). Amount, description, and leg id are not
 * evidence of origin. Zero or several matching credits stay unresolved.
 */
export function matchFundingCredit(opts: {
  payoutId: string;
  financialAccountId: string;
  amountMinor: number;
  currency: string;
  payoutStatus: string;
  livemode: boolean;
  credits: CreditLike[];
  claimedCreditIds: string[];
}): { creditId: string } | null {
  if (opts.payoutStatus !== "paid" || !opts.payoutId || !opts.financialAccountId) return null;
  const claimed = new Set(opts.claimedCreditIds.filter(Boolean));
  const matched = opts.credits.filter((credit) => {
    const id = typeof credit.id === "string" ? credit.id : "";
    if (!id || claimed.has(id) || isSimulatedFundingCredit(credit)) return false;
    if (credit.type !== "balance_transfer" || credit.status !== "succeeded") return false;
    if (credit.livemode !== opts.livemode) return false;
    if (credit.financial_account !== opts.financialAccountId) return false;
    if (balanceTransferPayoutId(credit) !== opts.payoutId) return false;
    const amount = creditAmount(credit);
    return amount?.value === opts.amountMinor && amount.currency === opts.currency.toLowerCase();
  });
  if (matched.length !== 1) return null;
  const id = matched[0].id;
  return typeof id === "string" ? { creditId: id } : null;
}

export type StoredQuoteState = "usable" | "missing" | "expired" | "confirmation_required";

export function classifyStoredQuote(opts: {
  quoteConfirmationRequired: boolean;
  quoteId: string;
  expiresAt: string;
  confirmedByUserId: string;
  nowMs: number;
}): StoredQuoteState {
  const expiresMs = Date.parse(opts.expiresAt || "");
  const alive =
    Boolean(opts.quoteId) && Boolean(opts.expiresAt) && !Number.isNaN(expiresMs) && expiresMs > opts.nowMs;
  if (opts.quoteConfirmationRequired) {
    return alive && opts.confirmedByUserId ? "usable" : "confirmation_required";
  }
  if (!opts.quoteId) return "missing";
  return alive ? "usable" : "expired";
}

export type ProceedsQuotePlan =
  | { action: "prepare_quote"; reason: "missing" | "expired" }
  | { action: "await_confirmation" }
  | { action: "wait_inflight" }
  | { action: "fund"; amountMinor: number; requiredMinor: number }
  | { action: "complete"; requiredMinor: number }
  | { action: "short"; requiredMinor: number }
  | { action: "blocked"; code: string };

/**
 * Quote first, then fund only the unpaid difference. A pending leg blocks
 * another payout. A higher fee that no longer fits the charge net does not
 * send a partial payout. A lower fee does not send the original amount again.
 */
export function planProceedsAfterQuote(opts: {
  quote: StoredQuoteState;
  principalMinor: number;
  payoutFeeMinor: number;
  chargeNetMinor: number;
  postedMinor: number;
  pendingMinor: number;
}): ProceedsQuotePlan {
  if (opts.pendingMinor > 0) return { action: "wait_inflight" };
  if (opts.quote === "confirmation_required") return { action: "await_confirmation" };
  if (opts.quote === "missing") return { action: "prepare_quote", reason: "missing" };
  if (opts.quote === "expired") return { action: "prepare_quote", reason: "expired" };
  const required = opts.principalMinor + opts.payoutFeeMinor;
  if (
    !Number.isInteger(opts.principalMinor) ||
    opts.principalMinor < 0 ||
    !Number.isInteger(opts.payoutFeeMinor) ||
    opts.payoutFeeMinor < 0 ||
    !Number.isInteger(opts.chargeNetMinor) ||
    opts.chargeNetMinor < 0 ||
    !Number.isInteger(opts.postedMinor) ||
    opts.postedMinor < 0
  ) {
    return { action: "blocked", code: "GP_FUNDING_AMOUNT" };
  }
  if (opts.postedMinor > opts.chargeNetMinor) {
    return { action: "blocked", code: "GP_FUNDING_OVER_CHARGE" };
  }
  if (required > opts.chargeNetMinor) return { action: "short", requiredMinor: required };
  if (opts.postedMinor >= required) return { action: "complete", requiredMinor: required };
  const outstanding = required - opts.postedMinor;
  if (opts.chargeNetMinor - opts.postedMinor < outstanding) {
    return { action: "short", requiredMinor: required };
  }
  return { action: "fund", amountMinor: outstanding, requiredMinor: required };
}

export function fundingPayoutMatchesLeg(
  payout: {
    id: string;
    amount: number;
    currency: string;
    metadata?: { sb_funding_leg?: string } | null;
    payoutMethod?: string | null;
    automatic?: boolean;
  },
  leg: { id: string; amountMinor: number; currency: string },
  financialAccountId: string,
): boolean {
  if (payout.automatic || !payout.id || !financialAccountId) return false;
  if (payout.metadata?.sb_funding_leg !== leg.id) return false;
  if (payout.amount !== leg.amountMinor) return false;
  if (payout.currency.toLowerCase() !== leg.currency.toLowerCase()) return false;
  return payout.payoutMethod === financialAccountId;
}

/**
 * A missing payout id is not a failure. Reattach a listed payout when Stripe
 * links it to this leg. Retry the same key only inside the idempotency window.
 * After that window, an unlistable result stays unresolved.
 */
export function decideFundingRequest(opts: {
  legExistedBeforeThisAttempt: boolean;
  ageMs: number;
  matchingPayoutIds: string[];
}): { action: "attach"; payoutId: string } | { action: "create_same_key" } | { action: "uncertain" } {
  const ids = [...new Set(opts.matchingPayoutIds.filter(Boolean))];
  if (ids.length > 1) return { action: "uncertain" };
  if (ids.length === 1) return { action: "attach", payoutId: ids[0] };
  if (!opts.legExistedBeforeThisAttempt) return { action: "create_same_key" };
  if (opts.ageMs >= 0 && opts.ageMs < STRIPE_IDEMPOTENCY_WINDOW_MS) return { action: "create_same_key" };
  return { action: "uncertain" };
}

/** An unreadable or non-manual bank payout schedule can take available proceeds first. */
export function automaticBankPayoutBlocksFunding(interval: string | null | undefined): {
  blocked: boolean;
  code: string;
} {
  const value = String(interval || "").trim().toLowerCase();
  if (value === "manual") return { blocked: false, code: "" };
  return { blocked: true, code: value ? "GP_AUTOMATIC_BANK_PAYOUT" : "GP_PAYOUT_SCHEDULE_UNREAD" };
}

function utcDate(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function addBusinessDays(start: Date, days: number): Date {
  const cursor = utcDate(start);
  let left = Math.max(0, days);
  while (left > 0) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return cursor;
}

export function businessDaysBetween(start: Date, end: Date): number {
  const from = utcDate(start).getTime();
  const to = utcDate(end).getTime();
  if (to <= from) return 0;
  let count = 0;
  const cursor = new Date(from);
  while (cursor.getTime() < to) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

export function formatPayoutDate(value: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

function clearingTiming(opts: {
  fundedAt: Date | null;
  availableOn: Date | null;
  now: Date;
  settled: boolean;
}): string {
  const usual =
    "Card payments usually clear in three business days from payment. Some payments take longer.";
  const funded = opts.fundedAt;
  const longer =
    funded != null &&
    ((opts.availableOn != null &&
      opts.availableOn.getTime() > addBusinessDays(funded, USUAL_CLEARING_BUSINESS_DAYS).getTime()) ||
      (!opts.settled &&
        opts.now.getTime() > addBusinessDays(funded, USUAL_CLEARING_BUSINESS_DAYS).getTime()));
  const delay = longer ? " This payment is taking longer than the usual three business days." : "";
  if (opts.availableOn) {
    return `Your payment is expected to clear on ${formatPayoutDate(opts.availableOn)}. ${usual}${delay}`;
  }
  return `${usual}${delay}`;
}

export function describeGpBuyerPayout(opts: {
  releaseAuthorized: boolean;
  txnStatus: string;
  outboundStatus?: string | null;
  outboundIdPresent?: boolean;
  failureCode?: string | null;
  fundingStatus?: string | null;
  chargeAvailable?: boolean;
  availableOn?: Date | null;
  fundedAt?: Date | null;
  expectedArrival?: Date | null;
  uncertain?: boolean;
  now?: Date;
  /** Automatic sentences require this. Absent or false means funding is off. */
  proceedsFundingEnabled?: boolean;
  /** Unread or non-manual payout schedule. */
  configurationBlocked?: boolean;
}): GpBuyerPayoutProgress | null {
  const now = opts.now ?? new Date();
  const outbound = String(opts.outboundStatus || "").toUpperCase();
  const failure = String(opts.failureCode || "");
  const fundingShort =
    failure === "GP_PILOT_FUNDING_SHORT" ||
    failure === "GP_FA_BALANCE_SHORT" ||
    failure === "GP_AWAITING_FA_FUNDS" ||
    outbound === "AWAITING_FA_FUNDS";
  if (outbound === "RETURNED") {
    return {
      phase: "returned",
      headline: "The international payout was returned. Source Bridge is reviewing it.",
      timing: "No further action is needed from you while it is reviewed.",
      hideReleaseActions: true,
    };
  }
  if (opts.uncertain || failure === "GP_PAYMENT_OUTCOME_UNCERTAIN") {
    return {
      phase: "uncertain",
      headline: "Release confirmed. We are checking the payout before offering any further action.",
      timing: "No further action is needed until that check finishes.",
      hideReleaseActions: true,
    };
  }
  if (
    (outbound === "SUCCEEDED" || outbound === "RECONCILED" || opts.txnStatus === "RELEASED") &&
    !fundingShort
  ) {
    return {
      phase: "sent",
      headline:
        "Your sourcer\u2019s international payout has been sent. Posted means the funds left Source Bridge. It does not confirm the sourcer\u2019s bank has paid.",
      timing: opts.expectedArrival
        ? `Stripe expects the bank to receive it on ${formatPayoutDate(opts.expectedArrival)}. This is not a promise that the sourcer is paid within three days of release.`
        : "Stripe has not given a bank arrival date. Arrival depends on the destination bank and is not promised within three days of release.",
      hideReleaseActions: true,
    };
  }
  if ((outbound === "PROCESSING" || outbound === "PENDING") && opts.outboundIdPresent) {
    return {
      phase: "sending",
      headline: "Sending your sourcer\u2019s international payout.",
      timing: opts.expectedArrival
        ? `Stripe expects the bank to receive it on ${formatPayoutDate(opts.expectedArrival)}. This is not a promise that the sourcer is paid within three days of release.`
        : "Stripe has not given a bank arrival date yet. Arrival depends on the destination bank and is not promised within three days of release.",
      hideReleaseActions: true,
    };
  }
  if (outbound === "FAILED" && !fundingShort) {
    return {
      phase: "failed",
      headline:
        "The international payout could not be sent. Your payment stays protected. Source Bridge will review it.",
      timing: "No further action is needed from you.",
      hideReleaseActions: true,
    };
  }
  if (!opts.releaseAuthorized && opts.txnStatus !== "READY_TO_RELEASE") return null;
  if (!opts.proceedsFundingEnabled || opts.configurationBlocked) {
    return {
      phase: "review",
      headline: GP_FUNDING_HOLD_COPY,
      timing: "No further action is needed from you.",
      hideReleaseActions: true,
    };
  }
  if (!opts.chargeAvailable) {
    return {
      phase: "waiting_settlement",
      headline: GP_RELEASE_WAITING_COPY,
      timing: clearingTiming({
        fundedAt: opts.fundedAt ?? null,
        availableOn: opts.availableOn ?? null,
        now,
        settled: false,
      }),
      hideReleaseActions: true,
    };
  }
  const processing = opts.fundingStatus === "FUNDING";
  return {
    phase: "waiting_funding",
    headline: processing ? GP_FUNDING_PROCESSING_COPY : GP_FUNDING_PROGRESS_COPY,
    timing: processing
      ? "Your payment has cleared. Source Bridge is moving the cleared amount into the international payout balance. This is not a promise that the sourcer is paid within three days of release."
      : "Your payment has cleared. The international payout starts automatically once that balance is ready. This is not a promise that the sourcer is paid within three days of release.",
    hideReleaseActions: true,
  };
}

export const GP_FUNDING_WAITING_CODES = new Set([
  "GP_AWAITING_FA_FUNDS",
  "GP_PILOT_FUNDING_SHORT",
  "GP_FA_BALANCE_SHORT",
  "GP_FA_BALANCE_HTTP",
  "GP_FA_BALANCE_CURRENCY",
  "GP_FA_BALANCE_AMOUNT",
  "GP_FA_BALANCE_PARSE",
  "GP_FA_ACCOUNT_MISMATCH",
  "GP_FA_MODE_MISMATCH",
]);
