/**
 * Settlement-currency transfer debit used by Connect release.
 * The inputs are the presentment amount being transferred and that charge's
 * own gross figures. An exchange rate is not an input. This is not a
 * presentment-currency payment.
 */

export function connectSettlementTransferMinor(
  presentmentMinor: number,
  chargeAmountMinor: number,
  balanceTransactionAmountMinor: number,
): number {
  return Math.max(1, Math.floor((presentmentMinor * balanceTransactionAmountMinor) / chargeAmountMinor));
}

export type OutstandingChargeSettlement =
  | {
      ok: true;
      chargeCurrency: string;
      chargeAmountMinor: number;
      balanceTransactionCurrency: string;
      balanceTransactionAmountMinor: number;
      balanceTransactionNetMinor: number;
    }
  | { ok: false; code: string };

type BalanceTransactionEvidence = {
  livemode?: boolean;
  currency?: string;
  amount?: number;
  net?: number;
  exchange_rate?: number | null;
};

function whole(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Evidence from a platform-scoped charge retrieve. Missing or rejected
 * evidence stays a blocker. No amount is returned as zero.
 */
export function shapeOutstandingChargeSettlement(input: {
  mode: "TEST" | "LIVE";
  purchaseCurrency: string;
  requestedChargeId: string;
  platformOwned: boolean;
  charge?: {
    id?: string;
    livemode?: boolean;
    currency?: string;
    amount?: number;
    balanceTransaction?: BalanceTransactionEvidence | string | null;
  } | null;
  failure?: { stripeCode: string | null };
}): OutstandingChargeSettlement {
  if (input.failure) return { ok: false, code: "SETTLEMENT_READ_FAILED" };
  if (!input.platformOwned || !input.requestedChargeId.trim()) {
    return { ok: false, code: "SETTLEMENT_OWNERSHIP_UNVERIFIED" };
  }
  const charge = input.charge;
  if (!charge || charge.id !== input.requestedChargeId) {
    return { ok: false, code: charge ? "SETTLEMENT_OWNERSHIP_UNVERIFIED" : "SETTLEMENT_READ_FAILED" };
  }
  const live = input.mode === "LIVE";
  if (charge.livemode !== live) return { ok: false, code: "SETTLEMENT_MODE_MISMATCH" };
  const transaction = charge.balanceTransaction;
  if (!transaction || typeof transaction === "string") return { ok: false, code: "SETTLEMENT_READ_FAILED" };
  if (typeof transaction.livemode === "boolean" && transaction.livemode !== live) {
    return { ok: false, code: "SETTLEMENT_MODE_MISMATCH" };
  }
  const purchaseCurrency = input.purchaseCurrency.trim().toUpperCase();
  const chargeCurrency = typeof charge.currency === "string" ? charge.currency.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(chargeCurrency) || chargeCurrency !== purchaseCurrency || !whole(charge.amount) || charge.amount <= 0) {
    return { ok: false, code: "SETTLEMENT_RESERVE_UNRESOLVED" };
  }
  const balanceTransactionCurrency =
    typeof transaction.currency === "string" ? transaction.currency.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(balanceTransactionCurrency)) return { ok: false, code: "SETTLEMENT_CURRENCY_UNKNOWN" };
  if (!whole(transaction.amount) || !whole(transaction.net)) {
    return { ok: false, code: "SETTLEMENT_RESERVE_UNRESOLVED" };
  }
  return {
    ok: true,
    chargeCurrency,
    chargeAmountMinor: charge.amount,
    balanceTransactionCurrency,
    balanceTransactionAmountMinor: transaction.amount,
    balanceTransactionNetMinor: transaction.net,
  };
}

export function applyOutstandingChargeSettlement<T extends {
  settlementCurrency?: string | null;
  chargeAmountMinor?: number | null;
  balanceTransactionAmountMinor?: number | null;
  settlementBlockCode?: string | null;
}>(purchase: T, facts: OutstandingChargeSettlement): T {
  if (!facts.ok) {
    return {
      ...purchase,
      settlementCurrency: null,
      chargeAmountMinor: null,
      balanceTransactionAmountMinor: null,
      settlementBlockCode: facts.code,
    };
  }
  return {
    ...purchase,
    settlementCurrency: facts.balanceTransactionCurrency,
    chargeAmountMinor: facts.chargeAmountMinor,
    balanceTransactionAmountMinor: facts.balanceTransactionAmountMinor,
    settlementBlockCode: null,
  };
}
