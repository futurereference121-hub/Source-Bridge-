/**
 * Financial Account balance reads for Global Payouts.
 * This module never creates a transfer, tops up an account, or moves a buyer
 * checkout receipt. Release uses an already-funded account; a short or
 * unreadable balance stops the payout.
 */

import {
  normalizeStripeMode,
  type StripeMode,
} from "@/lib/payments/flags";
import { canInitiateGlobalPayoutsMoney } from "@/lib/payments/payout-rail/eligibility";
import {
  getGlobalPayoutsFinancialAccountId,
  gpErrorMessage,
  gpFetch,
} from "@/lib/payments/payout-rail/gp-client";

export type FaBalanceFailureKind =
  | "http"
  | "account_mismatch"
  | "mode_mismatch"
  | "missing_currency"
  | "malformed_amount";

export type FaBalanceSnapshot = {
  financialAccountId: string;
  availableMinor: number | null;
  currency: string | null;
  rawOk: boolean;
  httpStatus: number | null;
  livemode: boolean | null;
  failureKind: FaBalanceFailureKind | null;
  errorCode: string | null;
  errorType: string | null;
};

const SAFE_TOKEN = /^[a-z0-9_]{1,64}$/i;

export function normalizeBalanceCurrency(currency: string | null | undefined): string | null {
  const normalized = String(currency || "").trim().toLowerCase();
  return /^[a-z]{3}$/.test(normalized) ? normalized : null;
}

function safeToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const token = value.trim();
  return SAFE_TOKEN.test(token) ? token : null;
}

function emptySnapshot(
  financialAccountId: string,
  failureKind: FaBalanceFailureKind,
): FaBalanceSnapshot {
  return {
    financialAccountId,
    availableMinor: null,
    currency: null,
    rawOk: false,
    httpStatus: null,
    livemode: null,
    failureKind,
    errorCode: null,
    errorType: null,
  };
}

function providerError(body: Record<string, unknown>): { code: string | null; type: string | null } {
  const err = body.error;
  if (!err || typeof err !== "object") return { code: null, type: null };
  const rec = err as Record<string, unknown>;
  return { code: safeToken(rec.code), type: safeToken(rec.type) };
}

/**
 * Read the pinned 2026-08-26.preview available balance.
 * `balance.available` is a map of lowercase ISO currency to `{ value, currency }`.
 * This never returns the response body, account id, or provider message text.
 */
export function interpretFinancialAccountBalance(opts: {
  body: Record<string, unknown>;
  currency: string;
  configuredAccountId: string;
  mode: StripeMode;
  httpOk: boolean;
  httpStatus: number;
}): FaBalanceSnapshot {
  const configured = opts.configuredAccountId.trim();
  const wanted = normalizeBalanceCurrency(opts.currency);
  if (!configured) return emptySnapshot("", "account_mismatch");
  if (!wanted) return emptySnapshot(configured, "missing_currency");

  if (!opts.httpOk) {
    const error = providerError(opts.body);
    return {
      ...emptySnapshot(configured, "http"),
      httpStatus: opts.httpStatus,
      errorCode: error.code,
      errorType: error.type,
    };
  }

  const responseId = typeof opts.body.id === "string" ? opts.body.id.trim() : "";
  if (!responseId || responseId !== configured) {
    return { ...emptySnapshot(configured, "account_mismatch"), httpStatus: opts.httpStatus };
  }

  const livemode = opts.body.livemode;
  const expectedLive = opts.mode === "LIVE";
  if (typeof livemode !== "boolean" || livemode !== expectedLive) {
    return {
      ...emptySnapshot(configured, "mode_mismatch"),
      httpStatus: opts.httpStatus,
      livemode: typeof livemode === "boolean" ? livemode : null,
    };
  }

  const balance =
    opts.body.balance && typeof opts.body.balance === "object"
      ? (opts.body.balance as Record<string, unknown>)
      : null;
  const available =
    balance?.available && typeof balance.available === "object" && !Array.isArray(balance.available)
      ? (balance.available as Record<string, unknown>)
      : null;
  const entry = available?.[wanted];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return {
      ...emptySnapshot(configured, "missing_currency"),
      httpStatus: opts.httpStatus,
      livemode,
    };
  }

  const amount = entry as Record<string, unknown>;
  const returned = normalizeBalanceCurrency(
    typeof amount.currency === "string" ? amount.currency : "",
  );
  const value = amount.value;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    returned !== wanted
  ) {
    return {
      ...emptySnapshot(configured, returned !== wanted ? "missing_currency" : "malformed_amount"),
      httpStatus: opts.httpStatus,
      livemode,
    };
  }

  return {
    financialAccountId: configured,
    availableMinor: value,
    currency: wanted,
    rawOk: true,
    httpStatus: opts.httpStatus,
    livemode,
    failureKind: null,
    errorCode: null,
    errorType: null,
  };
}

export function balanceFailureCode(snapshot: FaBalanceSnapshot): string {
  switch (snapshot.failureKind) {
    case "http":
      return "GP_FA_BALANCE_HTTP";
    case "account_mismatch":
      return "GP_FA_ACCOUNT_MISMATCH";
    case "mode_mismatch":
      return "GP_FA_MODE_MISMATCH";
    case "missing_currency":
      return "GP_FA_BALANCE_CURRENCY";
    case "malformed_amount":
      return "GP_FA_BALANCE_AMOUNT";
    default:
      return "GP_FA_BALANCE_PARSE";
  }
}

export function balanceFailureMessage(snapshot: FaBalanceSnapshot): string {
  if (snapshot.failureKind === "http") {
    const status = snapshot.httpStatus ?? "unknown";
    const code = snapshot.errorCode ? ` ${snapshot.errorCode}` : "";
    return `Financial Account balance request failed (${status}${code})`;
  }
  if (snapshot.failureKind === "account_mismatch") {
    return "Financial Account response did not match the configured account";
  }
  if (snapshot.failureKind === "mode_mismatch") {
    return "Financial Account livemode did not match the payout mode";
  }
  if (snapshot.failureKind === "missing_currency") {
    return "Financial Account has no available balance for the payout currency";
  }
  if (snapshot.failureKind === "malformed_amount") {
    return "Financial Account available amount is not a valid minor-unit integer";
  }
  return "Financial Account available balance could not be parsed";
}

export async function readFinancialAccountBalance(
  mode?: StripeMode,
  currency?: string,
): Promise<FaBalanceSnapshot> {
  const stripeMode = normalizeStripeMode(mode);
  const faId = getGlobalPayoutsFinancialAccountId(stripeMode);
  const wanted = normalizeBalanceCurrency(currency);
  if (!faId) return emptySnapshot("", "account_mismatch");
  if (!wanted) return emptySnapshot(faId, "missing_currency");

  const res = await gpFetch({
    mode: stripeMode,
    method: "GET",
    path: `/v2/money_management/financial_accounts/${encodeURIComponent(faId)}`,
  });

  return interpretFinancialAccountBalance({
    body: res.body,
    currency: wanted,
    configuredAccountId: faId,
    mode: stripeMode,
    httpOk: res.ok,
    httpStatus: res.status,
  });
}

/**
 * Confirm the financial account already has the payout amount.
 * Performs one balance read. Does not transfer funds into the account.
 * A short or unreadable balance, or disabled initiation, returns awaiting_funds
 * so release stops before any outbound payment is created.
 */
export async function ensureFinancialAccountFunding(opts: {
  mode: StripeMode;
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
  protectedTxnId: string;
}): Promise<
  | { status: "ready"; financialAccountId: string }
  | { status: "awaiting_funds"; financialAccountId: string; reason: string; code: string }
  | { status: "error"; message: string; code: string }
> {
  const stripeMode = normalizeStripeMode(opts.mode);
  const faId = getGlobalPayoutsFinancialAccountId(stripeMode);
  if (!faId) {
    return {
      status: "error",
      message: "Financial account is not configured",
      code: "GP_FA_NOT_CONFIGURED",
    };
  }

  if (!canInitiateGlobalPayoutsMoney(stripeMode)) {
    return {
      status: "awaiting_funds",
      financialAccountId: faId,
      code: "GP_INITIATION_DISABLED",
      reason:
        stripeMode === "LIVE"
          ? "Live FA funding disabled until approved enablement"
          : "Global Payouts money initiation disabled",
    };
  }

  // GET the existing balance only. Never top up, and never move the buyer receipt.
  const bal = await readFinancialAccountBalance(stripeMode, opts.currency);
  void opts.idempotencyKey;
  void opts.protectedTxnId;
  if (!bal.rawOk || bal.availableMinor == null) {
    return {
      status: "awaiting_funds",
      financialAccountId: faId,
      code: balanceFailureCode(bal),
      reason: balanceFailureMessage(bal),
    };
  }
  if (bal.availableMinor < opts.amountMinor) {
    return {
      status: "awaiting_funds",
      financialAccountId: faId,
      code: "GP_FA_BALANCE_SHORT",
      reason: "Insufficient Financial Account available balance",
    };
  }

  return { status: "ready", financialAccountId: faId };
}

export async function probeFinancialAccountConfigured(
  mode?: StripeMode,
): Promise<{ configured: boolean; error?: string }> {
  const stripeMode = normalizeStripeMode(mode);
  const faId = getGlobalPayoutsFinancialAccountId(stripeMode);
  if (!faId) return { configured: false, error: "missing_fa_id" };
  const res = await gpFetch({
    mode: stripeMode,
    method: "GET",
    path: `/v2/money_management/financial_accounts/${encodeURIComponent(faId)}`,
  });
  if (!res.ok) return { configured: false, error: gpErrorMessage(res) };
  return { configured: true };
}
