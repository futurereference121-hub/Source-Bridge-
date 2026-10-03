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

export type FaBalanceSnapshot = {
  financialAccountId: string;
  availableMinor: number | null;
  currency: string | null;
  rawOk: boolean;
};

export async function readFinancialAccountBalance(
  mode?: StripeMode,
): Promise<FaBalanceSnapshot> {
  const stripeMode = normalizeStripeMode(mode);
  const faId = getGlobalPayoutsFinancialAccountId(stripeMode);
  if (!faId) {
    return {
      financialAccountId: "",
      availableMinor: null,
      currency: null,
      rawOk: false,
    };
  }

  const res = await gpFetch({
    mode: stripeMode,
    method: "GET",
    path: `/v2/money_management/financial_accounts/${encodeURIComponent(faId)}`,
  });

  if (!res.ok) {
    return {
      financialAccountId: faId,
      availableMinor: null,
      currency: null,
      rawOk: false,
    };
  }

  const bal =
    res.body.balance && typeof res.body.balance === "object"
      ? (res.body.balance as Record<string, unknown>)
      : res.body;
  const cash =
    bal && typeof bal === "object"
      ? ((bal as { cash?: { available?: { value?: number; currency?: string } } })
          .cash?.available ??
        (bal as { available?: { value?: number; currency?: string } }).available)
      : null;

  return {
    financialAccountId: faId,
    availableMinor:
      cash && typeof cash.value === "number" ? cash.value : null,
    currency: cash && typeof cash.currency === "string" ? cash.currency : null,
    rawOk: true,
  };
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
  | { status: "awaiting_funds"; financialAccountId: string; reason: string }
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
      reason:
        stripeMode === "LIVE"
          ? "Live FA funding disabled until approved enablement"
          : "Global Payouts money initiation disabled",
    };
  }

  // GET the existing balance only. Never top up, and never move the buyer receipt.
  const bal = await readFinancialAccountBalance(stripeMode);
  void opts.idempotencyKey;
  void opts.protectedTxnId;
  void opts.currency;
  if (!bal.rawOk || bal.availableMinor == null) {
    return {
      status: "awaiting_funds",
      financialAccountId: faId,
      reason: "Financial Account balance could not be verified",
    };
  }
  if (bal.availableMinor < opts.amountMinor) {
    return {
      status: "awaiting_funds",
      financialAccountId: faId,
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
