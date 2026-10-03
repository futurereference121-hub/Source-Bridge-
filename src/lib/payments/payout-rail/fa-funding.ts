/**
 * Financial Account funding / balance reads for Global Payouts.
 * Live FA funding is disabled until GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED.
 * Never auto top-up live balances.
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
 * Record-only funding step. Does NOT move live funds unless initiation is enabled.
 * When initiation is disabled, returns pending so release can mark AWAITING_FA_FUNDS.
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

  // Read balance; do not auto top-up. Ops fund FA separately.
  const bal = await readFinancialAccountBalance(stripeMode);
  if (
    bal.availableMinor != null &&
    bal.availableMinor < opts.amountMinor
  ) {
    return {
      status: "awaiting_funds",
      financialAccountId: faId,
      reason: "Insufficient Financial Account available balance",
    };
  }

  // Optional: when Stripe exposes an explicit payments→FA transfer API, call it
  // here behind the same initiation gate. Until then, rely on prefunded FA.
  void opts.idempotencyKey;
  void opts.protectedTxnId;
  void opts.currency;

  if (!bal.rawOk) {
    // Soft-ready: allow OutboundPayment create to fail closed at Stripe if needed.
    return { status: "ready", financialAccountId: faId };
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
