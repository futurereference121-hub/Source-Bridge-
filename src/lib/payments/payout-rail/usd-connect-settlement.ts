/**
 * Shapes a read-only settlement report for funded TEST Connect purchases
 * priced in USD. Missing figures stay null. This module does not call Stripe
 * or write a database row.
 */

export function isUsdConnectSettlementPurchase(row: {
  stripeMode: string;
  currency: string;
  payoutRail: string;
  fundedAt: Date | string | null;
}): boolean {
  return (
    row.stripeMode === "TEST" &&
    row.currency.trim().toUpperCase() === "USD" &&
    row.payoutRail === "STRIPE_CONNECT" &&
    row.fundedAt != null
  );
}

export type SettlementRead = {
  ok: boolean;
  httpStatus: number | null;
  stripeCode: string | null;
};

export type PurchaseSettlement = {
  purchaseHash: string;
  purchaseCurrency: string;
  chargeCurrency: string | null;
  balanceTransactionCurrency: string | null;
  grossMinor: number | null;
  feeMinor: number | null;
  netMinor: number | null;
  exchangeRate: number | null;
  availabilityStatus: "pending" | "available" | null;
  availableOn: string | null;
  read: SettlementRead;
};

type BalanceTransactionShape = {
  livemode?: boolean;
  currency?: string;
  amount?: number;
  fee?: number;
  net?: number;
  exchange_rate?: number | null;
  status?: string;
  available_on?: number;
};

export type ChargeSettlementInput = {
  purchaseHash: string;
  purchaseCurrency: string;
  chargeIdPresent: boolean;
  charge?: {
    livemode?: boolean;
    currency?: string;
    balanceTransaction?: BalanceTransactionShape | string | null;
  } | null;
  failure?: { httpStatus: number | null; stripeCode: string | null };
};

function emptyPurchase(purchaseHash: string, purchaseCurrency: string, read: SettlementRead): PurchaseSettlement {
  return {
    purchaseHash,
    purchaseCurrency: purchaseCurrency.trim().toUpperCase(),
    chargeCurrency: null,
    balanceTransactionCurrency: null,
    grossMinor: null,
    feeMinor: null,
    netMinor: null,
    exchangeRate: null,
    availabilityStatus: null,
    availableOn: null,
    read,
  };
}

function failed(code: string, httpStatus: number | null = null): SettlementRead {
  return { ok: false, httpStatus, stripeCode: code };
}

function minor(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/** One purchase. A failed or incomplete read does not become a zero amount. */
export function shapeChargeSettlement(input: ChargeSettlementInput): PurchaseSettlement {
  const currency = input.purchaseCurrency.trim().toUpperCase();
  if (!input.chargeIdPresent) {
    return emptyPurchase(input.purchaseHash, currency, failed("charge_id_missing"));
  }
  if (input.failure) {
    return emptyPurchase(input.purchaseHash, currency, {
      ok: false,
      httpStatus: input.failure.httpStatus,
      stripeCode: input.failure.stripeCode,
    });
  }
  const charge = input.charge;
  if (!charge || charge.livemode !== false) {
    return emptyPurchase(input.purchaseHash, currency, failed(charge ? "mode_mismatch" : "charge_missing"));
  }
  const chargeCurrency = typeof charge.currency === "string" ? charge.currency.trim().toUpperCase() : "";
  const transaction = charge.balanceTransaction;
  if (!transaction || typeof transaction === "string") {
    return {
      ...emptyPurchase(input.purchaseHash, currency, failed("balance_transaction_missing")),
      chargeCurrency: chargeCurrency || null,
    };
  }
  // Charge.livemode is the TEST client contract. Balance Transaction in
  // API version 2025-08-27.basil has no livemode field; only an explicit true
  // is a LIVE object. An omitted field is not a mode mismatch.
  if (transaction.livemode === true) {
    return emptyPurchase(input.purchaseHash, currency, failed("mode_mismatch"));
  }
  const grossMinor = minor(transaction.amount);
  const feeMinor = minor(transaction.fee);
  const netMinor = minor(transaction.net);
  const balanceTransactionCurrency =
    typeof transaction.currency === "string" ? transaction.currency.trim().toUpperCase() : "";
  if (grossMinor == null || feeMinor == null || netMinor == null || !balanceTransactionCurrency) {
    return {
      ...emptyPurchase(input.purchaseHash, currency, failed("balance_amounts_missing")),
      chargeCurrency: chargeCurrency || null,
      balanceTransactionCurrency: balanceTransactionCurrency || null,
    };
  }
  const availabilityStatus =
    transaction.status === "pending" || transaction.status === "available" ? transaction.status : null;
  const availableOn =
    typeof transaction.available_on === "number"
      ? new Date(transaction.available_on * 1000).toISOString()
      : null;
  return {
    purchaseHash: input.purchaseHash,
    purchaseCurrency: currency,
    chargeCurrency: chargeCurrency || null,
    balanceTransactionCurrency,
    grossMinor,
    feeMinor,
    netMinor,
    exchangeRate: typeof transaction.exchange_rate === "number" ? transaction.exchange_rate : null,
    availabilityStatus,
    availableOn,
    read: { ok: availabilityStatus != null && availableOn != null, httpStatus: 200, stripeCode: availabilityStatus && availableOn ? null : "availability_missing" },
  };
}

export type BalanceAmount = {
  currency: string;
  amountMinor: number | null;
};

export type PlatformBalanceReport =
  | {
      ok: true;
      livemode: false;
      available: BalanceAmount[];
      pending: BalanceAmount[];
    }
  | {
      ok: false;
      livemode: null;
      stripeCode: string;
      httpStatus: number | null;
      available: null;
      pending: null;
    };

function balanceRows(rows: readonly { currency?: string; amount?: number }[] | null | undefined): BalanceAmount[] {
  return (rows ?? []).map((row) => ({
    currency: typeof row.currency === "string" ? row.currency.trim().toUpperCase() : "",
    amountMinor: minor(row.amount),
  }));
}

/** Platform balance only. A live-mode payload is not reported as amounts. */
export function shapePlatformBalance(input: {
  livemode?: boolean;
  available?: readonly { currency?: string; amount?: number }[] | null;
  pending?: readonly { currency?: string; amount?: number }[] | null;
  failure?: { httpStatus: number | null; stripeCode: string | null };
}): PlatformBalanceReport {
  if (input.failure) {
    return {
      ok: false,
      livemode: null,
      stripeCode: input.failure.stripeCode || "balance_unreadable",
      httpStatus: input.failure.httpStatus,
      available: null,
      pending: null,
    };
  }
  if (input.livemode !== false) {
    return {
      ok: false,
      livemode: null,
      stripeCode: "mode_mismatch",
      httpStatus: 200,
      available: null,
      pending: null,
    };
  }
  return {
    ok: true,
    livemode: false,
    available: balanceRows(input.available),
    pending: balanceRows(input.pending),
  };
}
