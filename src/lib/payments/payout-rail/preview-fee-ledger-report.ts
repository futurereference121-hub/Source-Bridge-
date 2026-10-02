/**
 * Redacted TEST-mode fee evidence for the existing Sandbox quote and payment.
 * Pure: no Stripe calls and no database access.
 * Equality of debit and presentment is reported as a fact. It is not treated
 * as proof that fees are included.
 */

import { redactedId, verifyHash8 } from "./preview-sandbox-verify-report.ts";

export const EXPECTED_QUOTE_H8 = "560891ba";
export const EXPECTED_PAYMENT_H8 = "2123f232";
export const FEE_LEDGER_PAGE_CAP = 5;

const CATEGORIES = new Set([
  "adjustment",
  "currency_conversion",
  "inbound_transfer",
  "inbound_transfer_reversal",
  "outbound_payment",
  "outbound_payment_reversal",
  "outbound_transfer",
  "outbound_transfer_reversal",
  "received_credit",
  "received_credit_reversal",
  "received_debit",
  "received_debit_reversal",
  "stripe_fee",
  "stripe_fee_tax",
]);

const FLOW_TYPES = new Set([
  "adjustment",
  "currency_conversion",
  "fee_transaction",
  "inbound_transfer",
  "outbound_payment",
  "outbound_transfer",
  "received_credit",
  "received_debit",
]);

const TXN_STATUS = new Set(["pending", "posted", "void"]);
const PAYMENT_STATUS = new Set([
  "processing",
  "failed",
  "posted",
  "returned",
  "canceled",
]);

export type MonetaryEvidence = {
  present: boolean;
  value_type: "absent" | "integer" | "decimal_number" | "numeric_string" | "unsupported";
  value: string | null;
  currency: string | null;
  safe_minor: number | null;
};

export type EstimatedFeeEvidence = {
  type: string;
  amount: MonetaryEvidence;
};

export type LinkedTransactionEvidence = {
  h8: string | null;
  category: string;
  status: string;
  livemode_false: boolean | null;
  flow_type: string;
  amount: MonetaryEvidence;
  available_impact: MonetaryEvidence;
};

export type LinkedEntryEvidence = {
  h8: string | null;
  transaction_h8: string | null;
  category: string;
  flow_type: string;
  available_impact: MonetaryEvidence;
};

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function currencyOf(raw: unknown): string | null {
  const code = String(raw || "").trim().toLowerCase();
  return /^[a-z]{3}$/.test(code) ? code : null;
}

function absentMoney(): MonetaryEvidence {
  return {
    present: false,
    value_type: "absent",
    value: null,
    currency: null,
    safe_minor: null,
  };
}

/** Preserve the provider's original numeric text. Never round a fraction into minor units. */
export function readMonetaryAmount(raw: unknown): MonetaryEvidence {
  const rec = asRecord(raw);
  if (!rec || !("value" in rec)) return absentMoney();
  const currency = currencyOf(rec.currency);
  const value = rec.value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return { present: true, value_type: "unsupported", value: null, currency, safe_minor: null };
    }
    if (Number.isInteger(value)) {
      if (!Number.isSafeInteger(value)) {
        return { present: true, value_type: "unsupported", value: null, currency, safe_minor: null };
      }
      return {
        present: true,
        value_type: "integer",
        value: String(value),
        currency,
        safe_minor: value,
      };
    }
    const text = JSON.stringify(value);
    if (!/^-?\d+\.\d+$/.test(text)) {
      return { present: true, value_type: "unsupported", value: null, currency, safe_minor: null };
    }
    return {
      present: true,
      value_type: "decimal_number",
      value: text,
      currency,
      safe_minor: null,
    };
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!/^-?\d+(\.\d+)?$/.test(text)) {
      return { present: true, value_type: "unsupported", value: null, currency, safe_minor: null };
    }
    const integer = /^-?\d+$/.test(text);
    const minor = integer ? Number(text) : null;
    return {
      present: true,
      value_type: integer ? "numeric_string" : "numeric_string",
      value: text,
      currency,
      safe_minor: minor != null && Number.isSafeInteger(minor) ? minor : null,
    };
  }
  return { present: true, value_type: "unsupported", value: null, currency, safe_minor: null };
}

export function readEstimatedFees(raw: unknown): {
  field: "absent" | "array" | "unsupported";
  fees: EstimatedFeeEvidence[];
} {
  if (raw == null) return { field: "absent", fees: [] };
  if (!Array.isArray(raw)) return { field: "unsupported", fees: [] };
  return {
    field: "array",
    fees: raw.map((item) => {
      const fee = asRecord(item);
      const typeRaw = String(fee?.type || "").trim().toLowerCase();
      const type = /^[a-z0-9_]{1,64}$/.test(typeRaw) ? typeRaw : "other";
      return { type, amount: readMonetaryAmount(fee?.amount) };
    }),
  };
}

export function sameCurrencyMinorSum(amounts: MonetaryEvidence[]): number | null {
  const present = amounts.filter((item) => item.present);
  if (present.length === 0) return 0;
  if (present.some((item) => item.safe_minor == null || !item.currency)) return null;
  const currency = present[0].currency;
  if (present.some((item) => item.currency !== currency)) return null;
  const sum = present.reduce((total, item) => total + (item.safe_minor as number), 0);
  return Number.isSafeInteger(sum) ? sum : null;
}

function token(raw: unknown, allowed: Set<string>): string {
  const value = String(raw || "").trim().toLowerCase();
  return allowed.has(value) ? value : value ? "other" : "absent";
}

export function outboundPaymentFlowId(flow: unknown): string | null {
  const rec = asRecord(flow);
  const id = rec?.outbound_payment;
  return typeof id === "string" && id.startsWith("obp_") ? id : null;
}

/** Provider relationship only: flow.outbound_payment equals the retrieved payment. */
export function transactionLinkedToPayment(row: unknown, paymentId: string): boolean {
  if (!paymentId.startsWith("obp_")) return false;
  const rec = asRecord(row);
  return outboundPaymentFlowId(rec?.flow) === paymentId;
}

export function entryLinkedToPayment(row: unknown, paymentId: string, transactionId: string): boolean {
  const rec = asRecord(row);
  if (!rec) return false;
  const details = asRecord(rec.transaction_details);
  const byFlow = outboundPaymentFlowId(details?.flow) === paymentId;
  const byTransaction =
    typeof rec.transaction === "string" &&
    transactionId.startsWith("trxn_") &&
    rec.transaction === transactionId;
  return byFlow || byTransaction;
}

function moneyView(amount: MonetaryEvidence) {
  return {
    present: amount.present,
    value_type: amount.value_type,
    value: amount.value,
    currency: amount.currency,
    safe_minor: amount.safe_minor,
  };
}

function quoteView(body: Record<string, unknown> | null, ok: boolean, livemode: boolean | null) {
  const id = typeof body?.id === "string" ? body.id : "";
  const redacted = redactedId(id);
  const from = asRecord(body?.from);
  const to = asRecord(body?.to);
  const fees = readEstimatedFees(body?.estimated_fees);
  return {
    retrieve_ok: ok,
    prefix: redacted.prefix,
    h8: redacted.h8,
    expected_h8_match: redacted.h8 === EXPECTED_QUOTE_H8,
    livemode_false: livemode === false,
    presentment: moneyView(readMonetaryAmount(body?.amount)),
    debited: moneyView(readMonetaryAmount(from?.debited)),
    destination_credit: moneyView(readMonetaryAmount(to?.credited)),
    estimated_fees_field: fees.field,
    estimated_fees: fees.fees.map((fee) => ({
      type: fee.type,
      ...moneyView(fee.amount),
    })),
  };
}

function paymentView(body: Record<string, unknown> | null, ok: boolean, livemode: boolean | null, quoteId: string) {
  const id = typeof body?.id === "string" ? body.id : "";
  const redacted = redactedId(id);
  const from = asRecord(body?.from);
  const to = asRecord(body?.to);
  const quoteRef = typeof body?.outbound_payment_quote === "string" ? body.outbound_payment_quote : "";
  return {
    retrieve_ok: ok,
    prefix: redacted.prefix,
    h8: redacted.h8,
    expected_h8_match: redacted.h8 === EXPECTED_PAYMENT_H8,
    status: token(body?.status, PAYMENT_STATUS),
    livemode_false: livemode === false,
    quote_relationship_matches: Boolean(quoteId) && quoteRef === quoteId,
    presentment: moneyView(readMonetaryAmount(body?.amount)),
    debited: moneyView(readMonetaryAmount(from?.debited)),
    destination_credit: moneyView(readMonetaryAmount(to?.credited)),
  };
}

function linkedTransactions(rows: unknown[], paymentId: string): {
  linked: LinkedTransactionEvidence[];
  unlinked_filter_rows: number;
} {
  let unlinked = 0;
  const linked: LinkedTransactionEvidence[] = [];
  for (const raw of rows) {
    if (!transactionLinkedToPayment(raw, paymentId)) {
      unlinked += 1;
      continue;
    }
    const row = asRecord(raw) || {};
    const id = typeof row.id === "string" ? row.id : "";
    const balance = asRecord(row.balance_impact);
    const flow = asRecord(row.flow);
    linked.push({
      h8: id ? verifyHash8(id) : null,
      category: token(row.category, CATEGORIES),
      status: token(row.status, TXN_STATUS),
      livemode_false: typeof row.livemode === "boolean" ? row.livemode === false : null,
      flow_type: token(flow?.type, FLOW_TYPES),
      amount: readMonetaryAmount(row.amount),
      available_impact: readMonetaryAmount(balance?.available),
    });
  }
  return { linked, unlinked_filter_rows: unlinked };
}

function linkedEntries(
  groups: Array<{ transactionId: string; rows: unknown[] }>,
  paymentId: string,
): { linked: LinkedEntryEvidence[]; unlinked_rows: number } {
  let unlinked = 0;
  const linked: LinkedEntryEvidence[] = [];
  for (const group of groups) {
    for (const raw of group.rows) {
      if (!entryLinkedToPayment(raw, paymentId, group.transactionId)) {
        unlinked += 1;
        continue;
      }
      const row = asRecord(raw) || {};
      const details = asRecord(row.transaction_details);
      const flow = asRecord(details?.flow);
      const id = typeof row.id === "string" ? row.id : "";
      const transaction = typeof row.transaction === "string" ? row.transaction : "";
      const balance = asRecord(row.balance_impact);
      linked.push({
        h8: id ? verifyHash8(id) : null,
        transaction_h8: transaction ? verifyHash8(transaction) : null,
        category: token(details?.category, CATEGORIES),
        flow_type: token(flow?.type, FLOW_TYPES),
        available_impact: readMonetaryAmount(balance?.available),
      });
    }
  }
  return { linked, unlinked_rows: unlinked };
}

function integersEqual(left: MonetaryEvidence, right: MonetaryEvidence): boolean | null {
  if (!left.present || !right.present) return null;
  if (left.safe_minor == null || right.safe_minor == null) return null;
  if (!left.currency || left.currency !== right.currency) return null;
  return left.safe_minor === right.safe_minor;
}

export function safeProviderError(status: number, body: Record<string, unknown> | null): {
  http_status: number;
  code: string | null;
  type: string | null;
} {
  const err = asRecord(body?.error);
  const code = typeof err?.code === "string" && /^[a-z0-9_]{1,64}$/.test(err.code) ? err.code : null;
  const type = typeof err?.type === "string" && /^[a-z0-9_]{1,64}$/.test(err.type) ? err.type : null;
  return { http_status: status, code, type };
}

export function buildFeeLedgerEvidence(opts: {
  hostH8: string | null;
  initiationIsFalse: boolean;
  deploymentCommit: string;
  fixtureOk: boolean;
  blocker: string | null;
  quoteId: string;
  paymentId: string;
  quoteOk: boolean;
  quoteLivemode: boolean | null;
  quoteBody: Record<string, unknown> | null;
  paymentOk: boolean;
  paymentLivemode: boolean | null;
  paymentBody: Record<string, unknown> | null;
  transactionList: {
    queried: boolean;
    filter: string;
    httpOk: boolean;
    complete: boolean;
    pages: number;
    rows: unknown[];
    error: { http_status: number; code: string | null; type: string | null } | null;
    rejected_filters: Array<{ filter: string; http_status: number; code: string | null; type: string | null }>;
  };
  entryList: {
    queried: boolean;
    httpOk: boolean;
    complete: boolean;
    pages: number;
    groups: Array<{ transactionId: string; rows: unknown[] }>;
  };
}): Record<string, unknown> {
  const quote = quoteView(opts.quoteBody, opts.quoteOk, opts.quoteLivemode);
  const payment = paymentView(opts.paymentBody, opts.paymentOk, opts.paymentLivemode, opts.quoteId);
  const transactions = linkedTransactions(opts.transactionList.rows, opts.paymentId);
  const entries = linkedEntries(opts.entryList.groups, opts.paymentId);
  const estimated = readEstimatedFees(opts.quoteBody?.estimated_fees);
  const estimatedSum = sameCurrencyMinorSum(estimated.fees.map((fee) => fee.amount));
  const presentment = readMonetaryAmount(opts.quoteBody?.amount);
  const debited = readMonetaryAmount(asRecord(opts.quoteBody?.from)?.debited);
  const debitEqualsPresentment = integersEqual(debited, presentment);
  const debitEqualsPresentmentPlusFees =
    debitEqualsPresentment == null || estimatedSum == null || debited.safe_minor == null
      ? null
      : debited.safe_minor === presentment.safe_minor! + estimatedSum;

  const feeTransactions = transactions.linked.filter(
    (row) => row.category === "stripe_fee" || row.category === "stripe_fee_tax",
  );
  const feeImpacts = feeTransactions.map((row) => row.available_impact);
  const linkedFeeSum = sameCurrencyMinorSum(feeImpacts.map((impact) => ({
    ...impact,
    safe_minor: impact.safe_minor == null ? null : Math.abs(impact.safe_minor),
  })));
  let actualFees: "no_linked_fee_transactions" | "same" | "differ" | "incomplete" | "unrepresentable" =
    "no_linked_fee_transactions";
  if (!opts.transactionList.complete || !opts.entryList.complete) actualFees = "incomplete";
  else if (feeTransactions.length === 0) actualFees = "no_linked_fee_transactions";
  else if (linkedFeeSum == null || estimatedSum == null) actualFees = "unrepresentable";
  else if (linkedFeeSum === estimatedSum && feeImpacts.every((item) => item.currency === presentment.currency)) {
    actualFees = "same";
  } else actualFees = "differ";

  const payoutTransactions = transactions.linked.filter((row) => row.category === "outbound_payment");

  return {
    label: "GP_FEE_LEDGER_EVIDENCE",
    ok: opts.blocker == null && opts.fixtureOk && opts.quoteOk && opts.paymentOk,
    blocker: opts.blocker,
    host_h8: opts.hostH8,
    deployment_commit: opts.deploymentCommit,
    initiation_is_false: opts.initiationIsFalse,
    fixture_matches: opts.fixtureOk,
    api_version: "2026-08-26.preview",
    quote,
    payment,
    transactions: {
      filter: opts.transactionList.filter,
      relationship: "flow.outbound_payment",
      queried: opts.transactionList.queried,
      http_ok: opts.transactionList.httpOk,
      error: opts.transactionList.error,
      rejected_filters: opts.transactionList.rejected_filters,
      pages: opts.transactionList.pages,
      page_cap: FEE_LEDGER_PAGE_CAP,
      complete: opts.transactionList.complete,
      matched_count: transactions.linked.length,
      unlinked_filter_rows: transactions.unlinked_filter_rows,
      rows: transactions.linked.map((row) => ({
        h8: row.h8,
        category: row.category,
        status: row.status,
        livemode_false: row.livemode_false,
        flow_type: row.flow_type,
        amount: moneyView(row.amount),
        available_impact: moneyView(row.available_impact),
      })),
    },
    entries: {
      filter: "transaction",
      queried: opts.entryList.queried,
      http_ok: opts.entryList.httpOk,
      pages: opts.entryList.pages,
      page_cap: FEE_LEDGER_PAGE_CAP,
      complete: opts.entryList.complete,
      matched_count: entries.linked.length,
      unlinked_rows: entries.unlinked_rows,
      rows: entries.linked.map((row) => ({
        h8: row.h8,
        transaction_h8: row.transaction_h8,
        category: row.category,
        flow_type: row.flow_type,
        available_impact: moneyView(row.available_impact),
      })),
    },
    comparison: {
      debit_equals_presentment: debitEqualsPresentment,
      fees_included_inferred_from_equality: false,
      same_currency_estimated_fee_safe_minor_sum: estimatedSum,
      debit_equals_presentment_plus_estimated_fees: debitEqualsPresentmentPlusFees,
      linked_outbound_payment_transaction_count: payoutTransactions.length,
      payout_transaction_amounts: payoutTransactions.map((row) => moneyView(row.amount)),
      linked_stripe_fee_transaction_count: feeTransactions.length,
      linked_stripe_fee_absolute_safe_minor_sum: linkedFeeSum,
      actual_fees_versus_estimates: actualFees,
      sandbox_absence_is_not_live_proof: true,
    },
    mutations: { stripe_writes: 0, db_writes: 0 },
    production_untouched: true,
  };
}
