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
  "Release confirmed. Your sourcer\u2019s international payout will be sent automatically once your payment is available. No further action is needed.";

export const GP_PROCUREMENT_PENDING_COPY =
  "Item release confirmed \u2014 transfer pending. The item amount is not marked sent until Stripe accepts the payout. Shipping and sourcer fee stay protected.";

export const GP_PROCUREMENT_PROCESSING_COPY =
  "Item funds sent \u2014 bank delivery pending. Shipping and sourcer fee stay protected.";

/** Funding is off, or the payout schedule blocks it. No internal account terms. */
export const GP_FUNDING_HOLD_COPY =
  "Release confirmed. Source Bridge is reviewing the payout. No further action is needed.";

/** Funding row unread / no confirmed charge state. */
export const GP_FUNDING_CHECKING_COPY =
  "Release confirmed. Checking payout status. No further action is needed.";

/**
 * Charge is available and a funding payout has not started.
 * Do not imply that a transfer is underway.
 */
export const GP_FUNDING_PROGRESS_COPY =
  "Release confirmed. Your payment is available. Source Bridge is waiting to fund your sourcer\u2019s international payout. No further action is needed.";

/** Funding payout is in progress after the charge became available. */
export const GP_FUNDING_PROCESSING_COPY =
  "Release confirmed. Source Bridge is funding your sourcer\u2019s international payout. No further action is needed.";

/** This purchase's funding credit is posted. Further progress is the outbound payout. */
export const GP_FUNDING_CONFIRMED_COPY =
  "Release confirmed. Payout funding is confirmed. No further action is needed.";

/** FINAL / whole-purchase outbound posted. Not used for a procurement item advance. */
export const GP_PAYOUT_SENT_COPY =
  "Your sourcer\u2019s international payout has been sent. Posted means the funds left Source Bridge. It does not confirm the sourcer\u2019s bank has paid.";

/** PROCUREMENT outbound posted. Remainder stays protected. */
export const GP_PROCUREMENT_SENT_COPY =
  "The item-advance payout has been sent. This is not the remaining shipping and sourcer fee. Posted means those item funds left Source Bridge. It does not confirm the sourcer\u2019s bank has paid.";

function formatItemAdvanceAmount(
  minor?: number | null,
  currency?: string | null,
): string | null {
  if (typeof minor !== "number" || !Number.isFinite(minor) || minor <= 0) return null;
  const code = String(currency || "GBP").toUpperCase();
  const formatted = (minor / 100).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (code === "GBP") return `\u00a3${formatted}`;
  return `${formatted} ${code}`;
}

export function gpProcurementSentCopy(opts?: {
  itemAdvanceMinor?: number | null;
  currency?: string | null;
}): string {
  const label = formatItemAdvanceAmount(opts?.itemAdvanceMinor, opts?.currency);
  if (!label) return GP_PROCUREMENT_SENT_COPY;
  return `The ${label} item advance has been sent. This is not the remaining shipping and sourcer fee. Posted means those item funds left Source Bridge. It does not confirm the sourcer\u2019s bank has paid.`;
}

const GP_FINAL_IN_FLIGHT_STATUSES = new Set([
  "AWAITING_FA_FUNDS",
  "PENDING",
  "PROCESSING",
  "AWAITING_MINIMUM",
  "ACTION_REQUIRED",
]);

/**
 * Hide buyer receipt / inspection / final-release actions only when FINAL
 * (or the whole purchase) is in-flight, posted, returned, or uncertain.
 * A succeeded PROCUREMENT advance must not hide an unpaid remainder.
 */
export function gpHidesFinalReleaseActions(opts: {
  outboundKind?: string | null;
  outboundStatus?: string | null;
  txnStatus?: string | null;
  remainderHeldMinor?: number | null;
  uncertain?: boolean | null;
}): boolean {
  const txn = String(opts.txnStatus || "").toUpperCase();
  const kind = String(opts.outboundKind || "").toUpperCase();
  const status = String(opts.outboundStatus || "").toUpperCase();
  if (opts.uncertain) return true;
  if (txn === "RELEASED") return true;
  if (status === "RETURNED") return true;
  const remainderHeld =
    typeof opts.remainderHeldMinor === "number" ? opts.remainderHeldMinor > 0 : true;
  if (kind === "PROCUREMENT") return !remainderHeld;
  if (status === "FAILED") return true;
  if (GP_FINAL_IN_FLIGHT_STATUSES.has(status)) return true;
  if (status === "SUCCEEDED" || status === "RECONCILED") return true;
  return false;
}

export type GpAwaitingFundsKind =
  | "unknown"
  | "payment_pending"
  | "funding_awaited"
  | "funding_in_progress"
  | "funding_confirmed"
  | "review";

/**
 * AWAITING_FA_FUNDS is a seller-outbound gate, not a buyer-status. Review is
 * only a genuine configuration hold. Unknown is not payment-pending.
 */
export function classifyGpAwaitingFunds(opts: {
  proceedsFundingEnabled?: boolean | null;
  configurationBlocked?: boolean | null;
  chargeAvailable?: boolean | null;
  fundingStatus?: string | null;
  failureCode?: string | null;
}): GpAwaitingFundsKind {
  const failure = String(opts.failureCode || "").trim();
  const status = String(opts.fundingStatus || "").trim().toUpperCase();
  if (
    opts.proceedsFundingEnabled === false ||
    opts.configurationBlocked === true ||
    failure === "GP_INITIATION_DISABLED" ||
    scheduleBlocksBuyerFunding(failure)
  ) {
    return "review";
  }
  if (status === "POSTED") return "funding_confirmed";
  if (status === "FUNDING") return "funding_in_progress";
  if (status === "SHORT") return "funding_awaited";
  if (status === "AWAITING_SETTLEMENT" || opts.chargeAvailable === false) return "payment_pending";
  if (opts.chargeAvailable === true) return "funding_awaited";
  return "unknown";
}

export function gpAwaitingFundsHeadline(
  kind: GpAwaitingFundsKind,
  opts?: { outboundKind?: string | null },
): string {
  if (String(opts?.outboundKind || "").toUpperCase() === "PROCUREMENT") {
    if (kind === "review") return GP_FUNDING_HOLD_COPY;
    if (kind === "funding_in_progress" || kind === "funding_confirmed") {
      return GP_PROCUREMENT_PROCESSING_COPY;
    }
    return GP_PROCUREMENT_PENDING_COPY;
  }
  if (kind === "review") return GP_FUNDING_HOLD_COPY;
  if (kind === "unknown") return GP_FUNDING_CHECKING_COPY;
  if (kind === "payment_pending") return GP_RELEASE_WAITING_COPY;
  if (kind === "funding_in_progress") return GP_FUNDING_PROCESSING_COPY;
  if (kind === "funding_confirmed") return GP_FUNDING_CONFIRMED_COPY;
  return GP_FUNDING_PROGRESS_COPY;
}

/** Short list phrase. Does not promise a three-day arrival. */
export function gpAwaitingFundsListPhrase(kind: GpAwaitingFundsKind): string {
  if (kind === "review") return "Release confirmed — Source Bridge is reviewing the payout";
  if (kind === "unknown") return "Release confirmed — checking payout status";
  if (kind === "funding_in_progress") {
    return "Release authorized — funding your sourcer\u2019s international payout";
  }
  if (kind === "funding_confirmed") return "Release authorized — payout funding is confirmed";
  if (kind === "funding_awaited") {
    return "Release authorized — waiting to fund your sourcer\u2019s international payout";
  }
  return "Release authorized — waiting for your payment to become available";
}

/** Stripe retains idempotency results for 24 hours. After that, the same key can create a new payout. */
export const STRIPE_IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

export const USUAL_CLEARING_BUSINESS_DAYS = 3;

export type GpBuyerPayoutPhase =
  | "checking"
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

export const GP_TEST_REPAIR_ABANDONED = "GP_TEST_REPAIR_ABANDONED";

export function isTestRepairAbandoned(opts: {
  stripeMode?: string | null;
  failureCode?: string | null;
}): boolean {
  return (
    String(opts.stripeMode || "").toUpperCase() === "TEST" &&
    String(opts.failureCode || "") === GP_TEST_REPAIR_ABANDONED
  );
}

const PROCUREMENT_FUNDING_AUTHORIZED_STATUSES = [
  "PENDING",
  "AWAITING_FA_FUNDS",
  "PROCESSING",
  "SUCCEEDED",
  "RECONCILED",
] as const;

/** Buyer-authorized item advance may fund FA proceeds. FAILED does not. */
export function procurementAttemptAllowsFunding(opts: {
  kind?: string | null;
  status?: string | null;
}): boolean {
  return (
    String(opts.kind || "").toUpperCase() === "PROCUREMENT" &&
    (PROCUREMENT_FUNDING_AUTHORIZED_STATUSES as readonly string[]).includes(
      String(opts.status || "").toUpperCase(),
    )
  );
}

/** Fund the authorized stage only. Final authorization funds the full seller principal. */
export function fundingPrincipalMinor(opts: {
  itemCostMinor: number;
  shippingMinor: number;
  sellerServiceFeeMinor: number;
  finalAuthorized?: boolean | null;
  procurementAuthorizedAmountMinor?: number | null;
}): number {
  const full =
    opts.itemCostMinor + opts.shippingMinor + opts.sellerServiceFeeMinor;
  if (opts.finalAuthorized) return full;
  const procurement = opts.procurementAuthorizedAmountMinor;
  if (Number.isInteger(procurement) && (procurement ?? 0) > 0) return procurement as number;
  return full;
}

export function fundingScanIncludesPurchase(opts: {
  txnStatus: string;
  outboundStatuses: readonly string[];
  hasPendingFundingLeg: boolean;
  stripeMode?: string | null;
  failureCode?: string | null;
}): boolean {
  if (opts.hasPendingFundingLeg) return true;
  if (isTestRepairAbandoned(opts)) return false;
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
  balanceTransactionId?: string | null;
};

export type ChargeSettlement =
  | {
      ok: true;
      chargeId: string;
      currency: string;
      netMinor: number;
      available: boolean;
      availableOn: Date | null;
      balanceTransactionId: string;
    }
  | { ok: false; code: string };

/**
 * API 2025-08-27.basil Balance Transaction objects have no `payout` property.
 * `payout` is only a list filter, and only for automatic Stripe payouts.
 * An absent object field is not evidence that the charge is still in the pool.
 */
export type ListedPayoutBalanceTransactions = {
  payoutId: string;
  automatic: boolean;
  listed: boolean;
  balanceTransactionIds: readonly string[];
};

export type ChargePayoutMembership =
  | { state: "paid_out"; code: "GP_CHARGE_PAID_OUT" }
  | { state: "unread"; code: "GP_CHARGE_PAYOUT_UNREAD" }
  | { state: "clear" };

export function balanceTransactionObjectHasPayoutProperty(keys: readonly string[]): boolean {
  return keys.includes("payout");
}

export function assessChargePayoutMembership(opts: {
  balanceTransactionId: string;
  ownFundingPayoutIds?: readonly string[];
  payoutLists: readonly ListedPayoutBalanceTransactions[];
}): ChargePayoutMembership {
  const btId = String(opts.balanceTransactionId || "").trim();
  if (!btId) return { state: "unread", code: "GP_CHARGE_PAYOUT_UNREAD" };
  const own = new Set((opts.ownFundingPayoutIds ?? []).filter(Boolean));
  let unread = false;
  for (const row of opts.payoutLists) {
    if (!row.automatic) continue;
    if (!row.listed) {
      unread = true;
      continue;
    }
    if (!row.balanceTransactionIds.includes(btId)) continue;
    if (own.has(row.payoutId)) continue;
    return { state: "paid_out", code: "GP_CHARGE_PAID_OUT" };
  }
  if (unread) return { state: "unread", code: "GP_CHARGE_PAYOUT_UNREAD" };
  return { state: "clear" };
}

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
  /**
   * Membership of this charge BT in automatic payout lists.
   * Omitted or unread must not be treated as “not paid out.”
   */
  chargePayoutMembership?: ChargePayoutMembership | null;
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
    balanceTransactionId:
      typeof input.balanceTransactionId === "string" ? input.balanceTransactionId.trim() : "",
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
  const membership = input.chargePayoutMembership ?? {
    state: "unread" as const,
    code: "GP_CHARGE_PAYOUT_UNREAD",
  };
  if (membership.state === "paid_out") {
    return { action: "wait", status: "SHORT", code: "GP_CHARGE_PAID_OUT" };
  }
  if (membership.state === "unread") {
    return { action: "wait", status: "SHORT", code: membership.code };
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

/**
 * Other Global Payouts purchases whose charges are already available must keep
 * their unpaid nets out of this purchase's platform room. Pending settlement
 * is skipped because those nets are not in the available card balance yet.
 * A charge already paid out to a non-own payout is skipped so it cannot be
 * ghost-reserved against another purchase's leftover available net.
 * Pending funding legs are subtracted here so they are not reserved twice.
 */
export type OtherGpFundingRow = {
  chargeNetMinor: number | null;
  status: string;
  failureCode: string;
  availableOn: Date | null;
  txnStatus: string;
  outboundStatuses: readonly string[];
  postedMinor: number;
  pendingMinor: number;
  stripeMode?: string | null;
};

export function otherGpAvailableUnpaidMinor(
  rows: readonly OtherGpFundingRow[],
  now: Date,
  unreadableOtherCount = 0,
): { minor: number; code: string | null } {
  if (!Number.isInteger(unreadableOtherCount) || unreadableOtherCount < 0) {
    return { minor: 0, code: "GP_RESERVE_UNKNOWN" };
  }
  if (unreadableOtherCount > 0) return { minor: 0, code: "GP_RESERVE_UNKNOWN" };
  let minor = 0;
  for (const row of rows) {
    const completed = completedPurchaseBlocksNewFunding({
      txnStatus: row.txnStatus,
      outboundStatuses: row.outboundStatuses,
    });
    if (completed && row.pendingMinor === 0) continue;
    if (row.failureCode === "GP_CHARGE_PAID_OUT") continue;
    if (isTestRepairAbandoned({ stripeMode: row.stripeMode, failureCode: row.failureCode })) continue;
    const awaiting =
      row.status === "AWAITING_SETTLEMENT" ||
      row.failureCode === "GP_CHARGE_PENDING" ||
      (row.availableOn != null && row.availableOn.getTime() > now.getTime());
    if (awaiting) continue;
    if (
      row.chargeNetMinor == null ||
      !Number.isInteger(row.chargeNetMinor) ||
      row.chargeNetMinor < 0 ||
      !Number.isInteger(row.postedMinor) ||
      row.postedMinor < 0 ||
      !Number.isInteger(row.pendingMinor) ||
      row.pendingMinor < 0
    ) {
      return { minor: 0, code: "GP_RESERVE_UNKNOWN" };
    }
    const unpaid = row.chargeNetMinor - row.postedMinor - row.pendingMinor;
    if (!Number.isInteger(unpaid) || unpaid < 0) return { minor: 0, code: "GP_RESERVE_UNKNOWN" };
    if (unpaid > 0) minor += unpaid;
  }
  return { minor, code: null };
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

function stringField(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/**
 * Pinned GP version is 2026-08-26.preview, after Stripe's 2026-07-29.preview
 * changelog removed `payout_v1` and added `payout`. Read the field the
 * response actually has. If both exist they must be the same id. Amount,
 * description, and type-enum aliases are not origin evidence.
 */
export function balanceTransferPayoutId(credit: CreditLike): string {
  const transfer = credit.balance_transfer;
  if (!transfer || typeof transfer !== "object") return "";
  const rec = transfer as { payout?: unknown; payout_v1?: unknown };
  const current = stringField(rec.payout);
  const legacy = stringField(rec.payout_v1);
  if (current && legacy && current !== legacy) return "";
  return current || legacy;
}

export function redactReceivedCreditInventory(opts: {
  credits: CreditLike[];
  financialAccountId: string;
  amountMinor: number;
  claimedCreditIds?: readonly string[];
}): {
  listed: number;
  creditKeys: string[];
  transferKeys: string[];
  types: Record<string, number>;
  statuses: Record<string, number>;
  hasPayoutField: boolean;
  hasPayoutV1Field: boolean;
  payoutFieldCount: number;
  payoutV1FieldCount: number;
  succeededBalanceTransfers: number;
  amountMatches: number;
  faMatches: number;
  livemodeFalse: number;
  claimedSkipped: number;
} {
  const claimed = new Set((opts.claimedCreditIds ?? []).filter(Boolean));
  const types: Record<string, number> = {};
  const statuses: Record<string, number> = {};
  const creditKeys = new Set<string>();
  const transferKeys = new Set<string>();
  let payoutFieldCount = 0;
  let payoutV1FieldCount = 0;
  let succeededBalanceTransfers = 0;
  let amountMatches = 0;
  let faMatches = 0;
  let livemodeFalse = 0;
  let claimedSkipped = 0;
  for (const credit of opts.credits) {
    for (const key of Object.keys(credit)) creditKeys.add(key);
    const transfer = credit.balance_transfer;
    if (transfer && typeof transfer === "object") {
      const rec = transfer as { payout?: unknown; payout_v1?: unknown };
      for (const key of Object.keys(rec)) transferKeys.add(key);
      if (stringField(rec.payout)) payoutFieldCount += 1;
      if (stringField(rec.payout_v1)) payoutV1FieldCount += 1;
    }
    const type = typeof credit.type === "string" ? credit.type : "unknown";
    const status = typeof credit.status === "string" ? credit.status : "unknown";
    types[type] = (types[type] || 0) + 1;
    statuses[status] = (statuses[status] || 0) + 1;
    if (typeof credit.id === "string" && claimed.has(credit.id)) claimedSkipped += 1;
    if (credit.type === "balance_transfer" && credit.status === "succeeded") {
      succeededBalanceTransfers += 1;
    }
    if (credit.livemode === false) livemodeFalse += 1;
    if (credit.financial_account === opts.financialAccountId) faMatches += 1;
    const amount = creditAmount(credit);
    if (amount?.value === opts.amountMinor) amountMatches += 1;
  }
  return {
    listed: opts.credits.length,
    creditKeys: [...creditKeys].sort(),
    transferKeys: [...transferKeys].sort(),
    types,
    statuses,
    hasPayoutField: transferKeys.has("payout"),
    hasPayoutV1Field: transferKeys.has("payout_v1"),
    payoutFieldCount,
    payoutV1FieldCount,
    succeededBalanceTransfers,
    amountMatches,
    faMatches,
    livemodeFalse,
    claimedSkipped,
  };
}

/**
 * Seller outbound may not treat a pooled FA balance as this purchase's
 * funding. Confirmation is a POSTED proceeds row whose posted legs cover
 * the required amount and each carry the matched ReceivedCredit id.
 */
export function proceedsFundingAllowsOutbound(opts: {
  payoutRail: string;
  proceedsFundingEnabled: boolean;
  funding: {
    status: string;
    postedMinor: number;
    pendingMinor: number;
    postedLegsHaveCredit: boolean;
  } | null;
  requiredMinor: number;
}): { ok: true } | { ok: false; code: "GP_PURCHASE_FUNDING_UNCONFIRMED" } {
  if (opts.payoutRail !== "STRIPE_GLOBAL_PAYOUTS") return { ok: true };
  if (!opts.funding && !opts.proceedsFundingEnabled) return { ok: true };
  if (
    opts.funding?.status === "POSTED" &&
    opts.funding.pendingMinor === 0 &&
    Number.isInteger(opts.requiredMinor) &&
    opts.requiredMinor > 0 &&
    opts.funding.postedMinor >= opts.requiredMinor &&
    opts.funding.postedLegsHaveCredit
  ) {
    return { ok: true };
  }
  return { ok: false, code: "GP_PURCHASE_FUNDING_UNCONFIRMED" };
}

/**
 * After a purchase is already released, do not open new funding. If posted
 * credited legs already cover the required amount, the row is POSTED. Do not
 * mark BLOCKED over completed evidence.
 */
export function fundingRowAfterCompletedPurchase(opts: {
  postedMinor: number;
  pendingMinor: number;
  requiredMinor: number;
  postedLegsHaveCredit: boolean;
}):
  | { status: "POSTED"; failureCode: "" }
  | { status: "BLOCKED"; failureCode: "GP_FUNDING_ALREADY_COMPLETED" }
  | { status: "unchanged" } {
  if (opts.pendingMinor > 0) return { status: "unchanged" };
  if (
    Number.isInteger(opts.requiredMinor) &&
    opts.requiredMinor > 0 &&
    opts.postedMinor >= opts.requiredMinor &&
    opts.postedLegsHaveCredit
  ) {
    return { status: "POSTED", failureCode: "" };
  }
  return { status: "BLOCKED", failureCode: "GP_FUNDING_ALREADY_COMPLETED" };
}

/**
 * Confirm a ReceivedCredit only when Stripe's pinned v2 object says this
 * credit came from this funding payout (`type=balance_transfer` and the
 * originating payout id). Amount, description, and leg id are not
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

/**
 * Every funding payouts.create, including pending-leg retries, must pass this
 * gate. An already-submitted payout may be reconciled without creating again.
 * Daily, weekly, monthly, missing, and failed schedule reads all block create.
 */
export function fundingPayoutCreateGate(opts: {
  alreadySubmitted: boolean;
  scheduleInterval: string | null | undefined;
  scheduleReadFailed?: boolean;
}): { action: "reconcile" | "create" | "block"; code: string } {
  if (opts.alreadySubmitted) return { action: "reconcile", code: "" };
  if (opts.scheduleReadFailed) return { action: "block", code: "GP_PAYOUT_SCHEDULE_UNREAD" };
  const schedule = automaticBankPayoutBlocksFunding(opts.scheduleInterval);
  if (schedule.blocked) return { action: "block", code: schedule.code };
  return { action: "create", code: "" };
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
  if (opts.availableOn) {
    const when = formatPayoutDate(opts.availableOn);
    const pending = opts.availableOn.getTime() > opts.now.getTime();
    const availability = pending
      ? `Stripe expects these funds to become available on ${when}.`
      : `Stripe marked these funds available on ${when}.`;
    return `${availability} Bank delivery follows payout submission. A bank-arrival estimate will appear when Stripe provides one. This availability date is not a bank-arrival time.`;
  }
  return "Stripe has not given an availability date yet. Bank delivery follows payout submission. A bank-arrival estimate will appear when Stripe provides one.";
}

export function describeGpBuyerPayout(opts: {
  releaseAuthorized: boolean;
  txnStatus: string;
  outboundKind?: string | null;
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
  remainderHeldMinor?: number | null;
  itemAdvanceMinor?: number | null;
  currency?: string | null;
  /** Automatic sentences require this. Absent or false means funding is off. */
  proceedsFundingEnabled?: boolean;
  /** Unread or non-manual payout schedule. */
  configurationBlocked?: boolean;
}): GpBuyerPayoutProgress | null {
  const now = opts.now ?? new Date();
  const outbound = String(opts.outboundStatus || "").toUpperCase();
  const outboundKind = String(opts.outboundKind || "").toUpperCase();
  const failure = String(opts.failureCode || "");
  const hideFinal = gpHidesFinalReleaseActions({
    outboundKind: opts.outboundKind,
    outboundStatus: opts.outboundStatus,
    txnStatus: opts.txnStatus,
    remainderHeldMinor: opts.remainderHeldMinor,
    uncertain: opts.uncertain || failure === "GP_PAYMENT_OUTCOME_UNCERTAIN",
  });
  const procurementRemainder =
    outboundKind === "PROCUREMENT" && opts.txnStatus !== "RELEASED";
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
      hideReleaseActions: hideFinal,
    };
  }
  if (opts.uncertain || failure === "GP_PAYMENT_OUTCOME_UNCERTAIN") {
    return {
      phase: "uncertain",
      headline: "Release confirmed. We are checking the payout before offering any further action.",
      timing: "No further action is needed until that check finishes.",
      hideReleaseActions: hideFinal,
    };
  }
  if (
    (outbound === "SUCCEEDED" || outbound === "RECONCILED" || opts.txnStatus === "RELEASED") &&
    !fundingShort
  ) {
    return {
      phase: "sent",
      headline: procurementRemainder
        ? gpProcurementSentCopy({
            itemAdvanceMinor: opts.itemAdvanceMinor,
            currency: opts.currency,
          })
        : GP_PAYOUT_SENT_COPY,
      timing: opts.expectedArrival
        ? `Stripe estimates bank arrival on ${formatPayoutDate(opts.expectedArrival)}. This is an estimate, not a promise.`
        : "A bank-arrival estimate will appear when Stripe provides one.",
      hideReleaseActions: hideFinal,
    };
  }
  if (
    (outbound === "PROCESSING" || outbound === "PENDING") &&
    (opts.outboundIdPresent || String(opts.fundingStatus || "").toUpperCase() === "POSTED")
  ) {
    return {
      phase: "sending",
      headline: procurementRemainder
        ? GP_PROCUREMENT_PROCESSING_COPY
        : "Sending your sourcer\u2019s international payout.",
      timing: opts.expectedArrival
        ? `Stripe estimates bank arrival on ${formatPayoutDate(opts.expectedArrival)}. This is an estimate, not a promise.`
        : "A bank-arrival estimate will appear when Stripe provides one.",
      hideReleaseActions: hideFinal,
    };
  }
  if (outbound === "FAILED" && !fundingShort) {
    return {
      phase: "failed",
      headline: procurementRemainder
        ? "The item-advance payout could not be sent. Remaining shipping and sourcer fee stay protected."
        : "The international payout could not be sent. Your payment stays protected. Source Bridge will review it.",
      timing: "No further action is needed from you.",
      hideReleaseActions: hideFinal,
    };
  }
  if (!opts.releaseAuthorized && opts.txnStatus !== "READY_TO_RELEASE") return null;
  const kind = classifyGpAwaitingFunds({
    proceedsFundingEnabled: opts.proceedsFundingEnabled === true,
    configurationBlocked: Boolean(opts.configurationBlocked),
    chargeAvailable:
      opts.chargeAvailable === true ? true : opts.chargeAvailable === false ? false : null,
    fundingStatus: opts.fundingStatus,
    failureCode: opts.failureCode,
  });
  if (kind === "review") {
    return {
      phase: "review",
      headline: gpAwaitingFundsHeadline(kind, { outboundKind: opts.outboundKind }),
      timing: "No further action is needed from you.",
      hideReleaseActions: hideFinal,
    };
  }
  if (kind === "unknown") {
    return {
      phase: "checking",
      headline: gpAwaitingFundsHeadline(kind, { outboundKind: opts.outboundKind }),
      timing: "No further action is needed.",
      hideReleaseActions: hideFinal,
    };
  }
  if (kind === "payment_pending") {
    return {
      phase: "waiting_settlement",
      headline: gpAwaitingFundsHeadline(kind, { outboundKind: opts.outboundKind }),
      timing: clearingTiming({
        fundedAt: opts.fundedAt ?? null,
        availableOn: opts.availableOn ?? null,
        now,
        settled: false,
      }),
      hideReleaseActions: hideFinal,
    };
  }
  if (kind === "funding_confirmed") {
    return {
      phase: "waiting_funding",
      headline: gpAwaitingFundsHeadline(kind, { outboundKind: opts.outboundKind }),
      timing:
        "Payout funding is confirmed. Further progress follows the payout status. This is not a bank-arrival time.",
      hideReleaseActions: hideFinal,
    };
  }
  return {
    phase: "waiting_funding",
    headline: gpAwaitingFundsHeadline(kind, { outboundKind: opts.outboundKind }),
    timing:
      kind === "funding_in_progress"
        ? "Source Bridge is funding the international payout balance. This is not a bank-arrival time."
        : "Your payment is available. Payout funding has not started. This is not a bank-arrival time.",
    hideReleaseActions: hideFinal,
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
