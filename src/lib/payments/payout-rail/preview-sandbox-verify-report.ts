/**
 * Redacted reporting for the existing Sandbox corrected payment.
 * Pure: no Stripe calls and no database access. Two local attempt rows
 * are not duplicate payments. Application success is not bank completion.
 */

import { createHash } from "node:crypto";

export const SANDBOX_VERIFY_FIXTURE = {
  hostH8: "bf232aa9",
  txnH8: "7162e1e3",
  originalAttemptH8: "d69014c5",
  correctedAttemptH8: "d2484765",
  recipientH8: "3525542e",
  payoutMethodH8: "574fcb48",
  amountMinor: 4000,
  currency: "gbp",
} as const;

const TERMINAL_STRIPE = new Set(["posted", "succeeded", "paid", "completed"]);
const FAILED_STRIPE = new Set(["failed", "canceled", "cancelled", "returned", "reversed"]);
const SAFE_STRIPE_STATUS = new Set([
  ...TERMINAL_STRIPE,
  ...FAILED_STRIPE,
  "processing",
  "pending",
  "in_transit",
  "submitted",
  "initiated",
  "requires_action",
  "action_required",
]);

const ID_PREFIXES = ["obpq_test_", "obp_test_", "obpq_", "obp_", "acct_", "thba_test_", "fa_test_"];

export function verifyHash8(value: string): string {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 8);
}

export function redactedId(id: string): { prefix: string | null; h8: string | null } {
  const value = String(id || "").trim();
  if (!value) return { prefix: null, h8: null };
  const prefix = ID_PREFIXES.find((item) => value.startsWith(item)) ?? "other";
  return { prefix, h8: verifyHash8(value) };
}

export function safeStripeStatus(raw: unknown): string | null {
  const status = String(raw || "").trim().toLowerCase();
  if (!status) return null;
  return SAFE_STRIPE_STATUS.has(status) ? status : "other";
}

export function stripeTerminalCompletion(
  status: string | null,
): "confirmed" | "pending" | "failed" | "unconfirmed" {
  if (!status || status === "other") return "unconfirmed";
  if (TERMINAL_STRIPE.has(status)) return "confirmed";
  if (FAILED_STRIPE.has(status)) return "failed";
  return "pending";
}

export type VerifyAttemptInput = {
  id: string;
  status: string;
  idempotencyKey: string;
  stripeOutboundPaymentId: string;
  fxRateSnapshot: string;
  amountMinor: number;
  currency: string;
  destinationCurrency: string;
  destinationAmountMinor: number;
  providerFeeMinor: number;
  crossBorderFeeMinor: number;
  fxFeeMinor: number;
  stripeRecipientId: string;
  stripePayoutMethodId: string;
  stripeMode: string;
};

export type ListedOutbound = {
  id: string;
  recipient: string;
  payoutMethod: string;
  financialAccount: string;
  amountMinor: number | null;
  currency: string;
  metadataTxnId: string;
  status: string;
  livemode: boolean | null;
};

export type RetrievedOutbound = {
  ok: boolean;
  id: string;
  status: string;
  livemode: boolean | null;
  recipient: string;
  payoutMethod: string;
  metadataTxnId: string;
};

export type RetrievedQuote = {
  attempted: boolean;
  ok: boolean;
  id: string;
  sourceAmountMinor: number | null;
  sourceCurrency: string | null;
  destinationAmountMinor: number | null;
  destinationCurrency: string | null;
};

type QuoteView = {
  present: boolean;
  prefix: string | null;
  h8: string | null;
  source_amount_minor: number | null;
  source_currency: string | null;
  destination_amount_minor: number | null;
  destination_currency: string | null;
  provider_fee_minor: number | null;
  cross_border_fee_minor: number | null;
  fx_fee_minor: number | null;
  retrieve_ok: boolean | null;
  retrieve_matches_persisted: boolean | null;
};

function parseQuote(raw: string): QuoteView {
  const empty: QuoteView = {
    present: false,
    prefix: null,
    h8: null,
    source_amount_minor: null,
    source_currency: null,
    destination_amount_minor: null,
    destination_currency: null,
    provider_fee_minor: null,
    cross_border_fee_minor: null,
    fx_fee_minor: null,
    retrieve_ok: null,
    retrieve_matches_persisted: null,
  };
  if (!raw) return empty;
  try {
    const snap = JSON.parse(raw) as Record<string, unknown>;
    const quoteId = typeof snap.quoteId === "string" ? snap.quoteId : "";
    const redacted = redactedId(quoteId);
    const integer = (value: unknown) =>
      typeof value === "number" && Number.isInteger(value) ? value : null;
    const currency = (value: unknown) => {
      const code = String(value || "").trim().toLowerCase();
      return /^[a-z]{3}$/.test(code) ? code : null;
    };
    return {
      present: Boolean(quoteId),
      prefix: redacted.prefix,
      h8: redacted.h8,
      source_amount_minor: integer(snap.sourceAmountMinor),
      source_currency: currency(snap.sourceCurrency),
      destination_amount_minor: integer(snap.destinationAmountMinor),
      destination_currency: currency(snap.destinationCurrency),
      provider_fee_minor: integer(snap.providerFeeMinor),
      cross_border_fee_minor: integer(snap.crossBorderFeeMinor),
      fx_fee_minor: integer(snap.fxFeeMinor),
      retrieve_ok: null,
      retrieve_matches_persisted: null,
    };
  } catch {
    return empty;
  }
}

function listedRowUnreadable(row: ListedOutbound): boolean {
  if (!row.id) return true;
  if (row.metadataTxnId) return false;
  return (
    !row.recipient ||
    !row.payoutMethod ||
    !row.financialAccount ||
    row.amountMinor == null ||
    !row.currency
  );
}

function listedRowMatches(row: ListedOutbound, opts: {
  txnId: string;
  recipientId: string;
  payoutMethodId: string;
  financialAccountId: string;
  amountMinor: number;
  currency: string;
}): boolean {
  if (!row.id) return false;
  if (row.metadataTxnId && row.metadataTxnId === opts.txnId) return true;
  if (!opts.financialAccountId) return false;
  return (
    row.recipient === opts.recipientId &&
    row.payoutMethod === opts.payoutMethodId &&
    row.financialAccount === opts.financialAccountId &&
    row.amountMinor === opts.amountMinor &&
    row.currency.toLowerCase() === opts.currency.toLowerCase()
  );
}

export function buildSandboxPaymentVerification(opts: {
  hostH8: string | null;
  initiationIsFalse: boolean;
  deploymentCommit: string;
  txn: {
    id: string;
    status: string;
    stripeMode: string;
    currency: string;
    itemCostMinor: number;
    sellerGpRecipientId: string;
    sellerGpPayoutMethodId: string;
  } | null;
  attempts: VerifyAttemptInput[];
  financialAccountId: string;
  listComplete: boolean;
  listed: ListedOutbound[];
  retrieved: RetrievedOutbound | null;
  quote: RetrievedQuote | null;
  connectTransferCount: number;
}): Record<string, unknown> {
  const txnH8 = opts.txn ? verifyHash8(opts.txn.id) : null;
  const attempts = opts.attempts.map((row) => {
    const attemptH8 = verifyHash8(row.id);
    const corrected = row.idempotencyKey.endsWith("_quote_v1");
    const role = corrected
      ? "corrected"
      : attemptH8 === SANDBOX_VERIFY_FIXTURE.originalAttemptH8
        ? "original"
        : "other";
    return {
      attempt_h8: attemptH8,
      role,
      status: row.status,
      outbound_present: Boolean(row.stripeOutboundPaymentId),
      corrected_retry: corrected,
      stripe_mode: row.stripeMode,
    };
  });
  const corrected = opts.attempts.filter((row) => row.idempotencyKey.endsWith("_quote_v1"));
  const correctedRow = corrected.length === 1 ? corrected[0] : null;
  const originalPresent = attempts.some((row) => row.role === "original");
  const quoteView = parseQuote(correctedRow?.fxRateSnapshot || "");
  if (!quoteView.present && correctedRow) {
    quoteView.source_amount_minor = correctedRow.amountMinor;
    quoteView.source_currency = correctedRow.currency.toLowerCase();
    quoteView.destination_amount_minor = correctedRow.destinationAmountMinor;
    quoteView.destination_currency = correctedRow.destinationCurrency
      ? correctedRow.destinationCurrency.toLowerCase()
      : null;
    quoteView.provider_fee_minor = correctedRow.providerFeeMinor;
    quoteView.cross_border_fee_minor = correctedRow.crossBorderFeeMinor;
    quoteView.fx_fee_minor = correctedRow.fxFeeMinor;
  }
  if (opts.quote?.attempted) {
    quoteView.retrieve_ok = opts.quote.ok;
    const persisted = redactedId(correctedRow?.fxRateSnapshot ? quoteIdOf(correctedRow.fxRateSnapshot) : "");
    const retrieved = redactedId(opts.quote.id);
    quoteView.retrieve_matches_persisted = Boolean(
      opts.quote.ok && persisted.h8 && retrieved.h8 && persisted.h8 === retrieved.h8,
    );
  }

  const storedId = correctedRow?.stripeOutboundPaymentId || "";
  const retrieved = opts.retrieved;
  const stripeStatus = retrieved?.ok ? safeStripeStatus(retrieved.status) : null;
  const stripeIds = redactedId(retrieved?.ok ? retrieved.id : storedId);
  const recipient = redactedId(retrieved?.recipient || opts.txn?.sellerGpRecipientId || "");
  const method = redactedId(retrieved?.payoutMethod || opts.txn?.sellerGpPayoutMethodId || "");
  const terminal = retrieved?.ok && retrieved.livemode === false
    ? stripeTerminalCompletion(stripeStatus)
    : "unconfirmed";

  const unreadable = opts.listed.some(listedRowUnreadable);
  const discoveryComplete = opts.listComplete && !unreadable;
  const matchIds = new Set<string>();
  if (opts.txn) {
    for (const row of opts.listed) {
      if (listedRowMatches(row, {
        txnId: opts.txn.id,
        recipientId: opts.txn.sellerGpRecipientId,
        payoutMethodId: opts.txn.sellerGpPayoutMethodId,
        financialAccountId: opts.financialAccountId,
        amountMinor: opts.txn.itemCostMinor,
        currency: opts.txn.currency,
      })) {
        matchIds.add(row.id);
      }
    }
  }
  if (storedId) matchIds.add(storedId);
  const distinct = matchIds.size;
  const duplicatePayments = distinct > 1 ? true : discoveryComplete ? false : null;

  let mismatch: string | null = null;
  if (correctedRow && retrieved?.ok && stripeStatus) {
    const mapped =
      stripeTerminalCompletion(stripeStatus) === "confirmed"
        ? "SUCCEEDED"
        : stripeTerminalCompletion(stripeStatus) === "failed"
          ? "FAILED"
          : "PROCESSING";
    if (
      (correctedRow.status === "SUCCEEDED" || correctedRow.status === "RECONCILED") &&
      mapped === "PROCESSING"
    ) {
      mismatch = "application_succeeded_stripe_not_terminal";
    } else if (
      (correctedRow.status === "SUCCEEDED" || correctedRow.status === "RECONCILED") &&
      mapped === "FAILED"
    ) {
      mismatch = "application_succeeded_stripe_failed";
    } else if (correctedRow.status === "PROCESSING" && mapped === "SUCCEEDED") {
      mismatch = "stripe_terminal_application_processing";
    } else if (opts.txn?.status === "RELEASED" && terminal !== "confirmed") {
      mismatch = "application_released_stripe_not_terminal";
    }
  } else if (opts.txn?.status === "RELEASED" && terminal !== "confirmed") {
    mismatch = "application_released_stripe_not_terminal";
  }

  const fixtureOk =
    opts.hostH8 === SANDBOX_VERIFY_FIXTURE.hostH8 &&
    txnH8 === SANDBOX_VERIFY_FIXTURE.txnH8 &&
    opts.txn?.stripeMode === "TEST" &&
    opts.txn.itemCostMinor === SANDBOX_VERIFY_FIXTURE.amountMinor &&
    opts.txn.currency.toLowerCase() === SANDBOX_VERIFY_FIXTURE.currency &&
    originalPresent &&
    corrected.length === 1 &&
    verifyHash8(correctedRow!.id) === SANDBOX_VERIFY_FIXTURE.correctedAttemptH8 &&
    opts.initiationIsFalse;
  const recipientOk = recipient.h8 === SANDBOX_VERIFY_FIXTURE.recipientH8;
  const methodOk = method.h8 === SANDBOX_VERIFY_FIXTURE.payoutMethodH8;
  const evidenceOk =
    fixtureOk &&
    recipientOk &&
    methodOk &&
    retrieved?.ok === true &&
    retrieved.livemode === false &&
    discoveryComplete &&
    distinct === 1 &&
    quoteView.present &&
    opts.connectTransferCount === 0;

  let blocker: string | null = null;
  if (!opts.initiationIsFalse) blocker = "initiation_not_false";
  else if (opts.hostH8 !== SANDBOX_VERIFY_FIXTURE.hostH8) blocker = "database_host_mismatch";
  else if (!opts.txn || txnH8 !== SANDBOX_VERIFY_FIXTURE.txnH8) blocker = "fixture_mismatch";
  else if (opts.txn.stripeMode !== "TEST") blocker = "not_test_mode";
  else if (
    opts.txn.itemCostMinor !== SANDBOX_VERIFY_FIXTURE.amountMinor ||
    opts.txn.currency.toLowerCase() !== SANDBOX_VERIFY_FIXTURE.currency
  ) blocker = "amount_mismatch";
  else if (!originalPresent) blocker = "original_attempt_missing";
  else if (corrected.length !== 1) blocker = "corrected_attempt_count";
  else if (verifyHash8(correctedRow!.id) !== SANDBOX_VERIFY_FIXTURE.correctedAttemptH8) blocker = "corrected_attempt_mismatch";
  else if (!storedId) blocker = "stored_outbound_missing";
  else if (!retrieved?.ok) blocker = "stored_outbound_unretrieved";
  else if (retrieved.livemode !== false) blocker = "livemode_not_false";
  else if (!discoveryComplete) blocker = "reconciliation_incomplete";
  else if (distinct !== 1) blocker = distinct > 1 ? "duplicate_outbound_payments" : "matching_payment_missing";
  else if (!quoteView.present) blocker = "quote_snapshot_missing";
  else if (!recipientOk || !methodOk) blocker = "destination_mismatch";
  else if (opts.connectTransferCount !== 0) blocker = "connect_transfer_present";

  return {
    label: "GP_SANDBOX_PAYMENT_VERIFICATION",
    ok: evidenceOk,
    status: evidenceOk ? "GP_SANDBOX_PAYMENT_VERIFIED" : "GP_SANDBOX_PAYMENT_VERIFICATION_BLOCKED",
    blocker,
    host_h8: opts.hostH8,
    deployment_commit: opts.deploymentCommit,
    initiation_is_false: opts.initiationIsFalse,
    fixture_txn_h8: txnH8,
    amount_minor: opts.txn?.itemCostMinor ?? null,
    currency: opts.txn?.currency ?? null,
    stripe_mode: opts.txn?.stripeMode ?? null,
    application_transaction_status: opts.txn?.status ?? null,
    application_released: opts.txn?.status === "RELEASED",
    attempt_count: opts.attempts.length,
    attempts,
    quote: quoteView,
    outbound: {
      retrieve_ok: retrieved?.ok === true,
      prefix: stripeIds.prefix,
      h8: stripeIds.h8,
      livemode_false: retrieved?.ok === true ? retrieved.livemode === false : null,
      stripe_status: stripeStatus,
      recipient_h8: recipient.h8,
      payout_method_h8: method.h8,
      recipient_matches: recipientOk,
      payout_method_matches: methodOk,
    },
    duplicate_discovery: {
      complete: discoveryComplete,
      distinct_matching_payment_count: distinct,
      duplicate_payments: duplicatePayments,
      attempt_rows_are_not_payments: true,
    },
    terminal_completion: terminal,
    application_stripe_mismatch: mismatch,
    connect_transfer_count: opts.connectTransferCount,
    connect_untouched: opts.connectTransferCount === 0,
    production_untouched: true,
    mutations: { stripe_writes: 0, db_writes: 0 },
  };
}

function quoteIdOf(raw: string): string {
  try {
    const snap = JSON.parse(raw) as { quoteId?: unknown };
    return typeof snap.quoteId === "string" ? snap.quoteId : "";
  } catch {
    return "";
  }
}
