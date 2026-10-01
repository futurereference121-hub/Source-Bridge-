/**
 * Cross-border OutboundPaymentQuote sequencing for Global Payouts API
 * 2026-08-26.preview. Quote and payment creates do not use Stripe-Context;
 * that header stays on recipient-scoped payout-method reads.
 * Source amount stays the entitlement currency. Destination currency comes
 * from the payout method, not from country.
 */

import { sanitizeProviderFailureText } from "./outbound-display.ts";

export const OUTBOUND_PAYMENT_QUOTE_PATH = "/v2/money_management/outbound_payment_quotes";
export const OUTBOUND_PAYMENT_PATH = "/v2/money_management/outbound_payments";

const SAFE_TOKEN = /^[a-z0-9_.:-]{1,80}$/i;

export type GpProviderError = {
  httpStatus: number | null;
  type: string | null;
  code: string | null;
  param: string | null;
  requestId: string | null;
  message: string;
};

export type QuoteSnapshot = {
  v: 1;
  quoteId: string;
  sourceAmountMinor: number;
  sourceCurrency: string;
  destinationCurrency: string;
  destinationAmountMinor: number;
  expiresAt: string;
  lockStatus: string;
  rate: string;
  providerFeeMinor: number;
  crossBorderFeeMinor: number;
  fxFeeMinor: number;
};

export type QuoteHttpResult = {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
  requestId?: string | null;
};

export function parseGpProviderError(result: {
  status?: number;
  body?: Record<string, unknown> | null;
  requestId?: string | null;
}): GpProviderError {
  const err = result.body?.error;
  const rec = err && typeof err === "object" ? (err as Record<string, unknown>) : {};
  const type = typeof rec.type === "string" && SAFE_TOKEN.test(rec.type) ? rec.type : null;
  const code = typeof rec.code === "string" && SAFE_TOKEN.test(rec.code) ? rec.code : null;
  const param =
    typeof rec.param === "string" &&
    rec.param.length <= 80 &&
    !/acct_|fa_|thba_|obp_|sk_|rk_/i.test(rec.param)
      ? rec.param
      : null;
  const requestId =
    typeof result.requestId === "string" && /^req_[A-Za-z0-9]+$/.test(result.requestId)
      ? result.requestId
      : null;
  const rawMessage =
    typeof rec.message === "string"
      ? rec.message
      : `Global Payouts API error (${result.status ?? "unknown"})`;
  return {
    httpStatus: typeof result.status === "number" ? result.status : null,
    type,
    code,
    param,
    requestId,
    message: sanitizeProviderFailureText(rawMessage),
  };
}

export function providerErrorRecord(parsed: GpProviderError): string {
  return JSON.stringify({
    httpStatus: parsed.httpStatus,
    type: parsed.type,
    code: parsed.code,
    param: parsed.param,
    requestId: parsed.requestId,
  }).slice(0, 500);
}

export function providerOutcomeUncertain(status: number | null, hasProviderId: boolean): boolean {
  if (hasProviderId) return false;
  if (status == null || status === 0 || status >= 500 || status === 408 || status === 409 || status === 429) {
    return true;
  }
  return false;
}

export function quoteIdempotencyKey(paymentIdempotencyKey: string): string {
  return `${paymentIdempotencyKey}_quote`;
}

/** Future corrected retry. Does not reuse a key whose body would change. */
export function correctedQuoteRetryKey(baseIdempotencyKey: string): string {
  return `${baseIdempotencyKey}_quote_v1`;
}

export function payoutMethodCurrencies(method: Record<string, unknown> | null | undefined): string[] {
  if (!method) return [];
  const found: string[] = [];
  for (const key of ["bank_account", "card"] as const) {
    const container = method[key];
    if (!container || typeof container !== "object") continue;
    const list = (container as { supported_currencies?: unknown }).supported_currencies;
    if (!Array.isArray(list)) continue;
    for (const raw of list) {
      const code = String(raw || "").trim().toLowerCase();
      if (/^[a-z]{3}$/.test(code) && !found.includes(code)) found.push(code);
    }
  }
  return found;
}

export function resolveDestinationCurrency(opts: {
  supportedCurrencies: string[];
  /** Stored recipient defaultCurrency. Ignored unless it is one of the method currencies. */
  mappedCurrency?: string | null;
}): { ok: true; currency: string } | { ok: false; code: "GP_DESTINATION_CURRENCY_UNRESOLVED" } {
  const supported = opts.supportedCurrencies;
  if (supported.length === 1) return { ok: true, currency: supported[0] };
  const mapped = String(opts.mappedCurrency || "").trim().toLowerCase();
  if (mapped && /^[a-z]{3}$/.test(mapped) && supported.includes(mapped)) {
    return { ok: true, currency: mapped };
  }
  return { ok: false, code: "GP_DESTINATION_CURRENCY_UNRESOLVED" };
}

export function quoteRequired(sourceCurrency: string, destinationCurrency: string): boolean {
  return sourceCurrency.trim().toLowerCase() !== destinationCurrency.trim().toLowerCase();
}

export function buildQuoteBody(opts: {
  financialAccountId: string;
  recipientId: string;
  payoutMethodId: string;
  sourceAmountMinor: number;
  sourceCurrency: string;
  destinationCurrency: string;
}): Record<string, unknown> {
  const source = opts.sourceCurrency.toLowerCase();
  const destination = opts.destinationCurrency.toLowerCase();
  return {
    from: { financial_account: opts.financialAccountId, currency: source },
    to: {
      recipient: opts.recipientId,
      payout_method: opts.payoutMethodId,
      currency: destination,
    },
    amount: { value: opts.sourceAmountMinor, currency: source },
  };
}

export function buildSameCurrencyPaymentBody(opts: {
  financialAccountId: string;
  recipientId: string;
  payoutMethodId: string;
  sourceAmountMinor: number;
  sourceCurrency: string;
  metadata: Record<string, string>;
}): Record<string, unknown> {
  const source = opts.sourceCurrency.toLowerCase();
  return {
    from: { financial_account: opts.financialAccountId, currency: source },
    to: { payout_method: opts.payoutMethodId, recipient: opts.recipientId },
    amount: { value: opts.sourceAmountMinor, currency: source },
    metadata: opts.metadata,
  };
}

export function buildQuotedPaymentBody(opts: {
  financialAccountId: string;
  recipientId: string;
  payoutMethodId: string;
  sourceAmountMinor: number;
  sourceCurrency: string;
  destinationCurrency: string;
  quoteId: string;
  metadata: Record<string, string>;
}): Record<string, unknown> {
  const source = opts.sourceCurrency.toLowerCase();
  const destination = opts.destinationCurrency.toLowerCase();
  return {
    from: { financial_account: opts.financialAccountId, currency: source },
    to: {
      recipient: opts.recipientId,
      payout_method: opts.payoutMethodId,
      currency: destination,
    },
    amount: { value: opts.sourceAmountMinor, currency: source },
    outbound_payment_quote: opts.quoteId,
    metadata: opts.metadata,
  };
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as Record<string, unknown>;
}

function minorAmount(raw: unknown): { value: number; currency: string } | null {
  const rec = asRecord(raw);
  if (!rec || typeof rec.value !== "number" || !Number.isInteger(rec.value)) return null;
  if (typeof rec.currency !== "string" || !/^[a-z]{3}$/i.test(rec.currency)) return null;
  return { value: rec.value, currency: rec.currency.toLowerCase() };
}

function integerFee(raw: unknown): number | null {
  const rec = asRecord(raw);
  const value = rec && typeof rec.value === "number" ? rec.value : null;
  if (value == null || !Number.isInteger(value) || value < 0) return null;
  return value;
}

export function parseQuoteSnapshot(raw: string | null | undefined): QuoteSnapshot | null {
  if (!raw || !raw.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<QuoteSnapshot>;
    if (parsed.v !== 1 || typeof parsed.quoteId !== "string" || !parsed.quoteId) return null;
    if (typeof parsed.sourceAmountMinor !== "number" || typeof parsed.destinationAmountMinor !== "number") {
      return null;
    }
    return parsed as QuoteSnapshot;
  } catch {
    return null;
  }
}

export function validateOutboundQuote(opts: {
  body: Record<string, unknown>;
  financialAccountId: string;
  recipientId: string;
  payoutMethodId: string;
  sourceAmountMinor: number;
  sourceCurrency: string;
  destinationCurrency: string;
  mode: "TEST" | "LIVE";
  nowMs: number;
}): { ok: true; snapshot: QuoteSnapshot } | { ok: false; code: "GP_QUOTE_MISMATCH" | "GP_QUOTE_EXPIRED" } {
  const source = opts.sourceCurrency.toLowerCase();
  const destination = opts.destinationCurrency.toLowerCase();
  const amount = minorAmount(opts.body.amount);
  const from = asRecord(opts.body.from);
  const debited = minorAmount(from?.debited);
  const to = asRecord(opts.body.to);
  const credited = minorAmount(to?.credited);
  const fx = asRecord(opts.body.fx_quote);
  const expiresAt = typeof fx?.lock_expires_at === "string" ? fx.lock_expires_at : "";
  const lockStatus = typeof fx?.lock_status === "string" ? fx.lock_status.toLowerCase() : "";
  const quoteId = typeof opts.body.id === "string" ? opts.body.id : "";
  const livemode = opts.body.livemode;
  const expectedLive = opts.mode === "LIVE";

  if (
    !quoteId.startsWith("obpq_") ||
    !amount ||
    amount.value !== opts.sourceAmountMinor ||
    amount.currency !== source ||
    !debited ||
    debited.value !== opts.sourceAmountMinor ||
    debited.currency !== source ||
    from?.financial_account !== opts.financialAccountId ||
    !credited ||
    credited.currency !== destination ||
    credited.value <= 0 ||
    to?.recipient !== opts.recipientId ||
    to?.payout_method !== opts.payoutMethodId ||
    livemode !== expectedLive
  ) {
    return { ok: false, code: "GP_QUOTE_MISMATCH" };
  }
  const expiresMs = Date.parse(expiresAt);
  if (!expiresAt || Number.isNaN(expiresMs) || expiresMs <= opts.nowMs || (lockStatus && lockStatus !== "active")) {
    return { ok: false, code: "GP_QUOTE_EXPIRED" };
  }
  const toCurrency = typeof fx?.to_currency === "string" ? fx.to_currency.toLowerCase() : "";
  if (toCurrency && toCurrency !== destination) return { ok: false, code: "GP_QUOTE_MISMATCH" };

  let providerFeeMinor = 0;
  let crossBorderFeeMinor = 0;
  let fxFeeMinor = 0;
  if (Array.isArray(opts.body.estimated_fees)) {
    for (const raw of opts.body.estimated_fees) {
      const fee = asRecord(raw);
      const val = integerFee(fee?.amount);
      if (val == null) continue;
      const type = String(fee?.type || "").toLowerCase();
      if (type.includes("cross")) crossBorderFeeMinor += val;
      else if (type.includes("fx") || type.includes("exchange")) fxFeeMinor += val;
      else providerFeeMinor += val;
    }
  }
  const rates = asRecord(fx?.rates);
  const sourceRate = asRecord(rates?.[source]);
  const rate = typeof sourceRate?.exchange_rate === "string" ? sourceRate.exchange_rate.slice(0, 64) : "";

  return {
    ok: true,
    snapshot: {
      v: 1,
      quoteId,
      sourceAmountMinor: opts.sourceAmountMinor,
      sourceCurrency: source,
      destinationCurrency: destination,
      destinationAmountMinor: credited.value,
      expiresAt,
      lockStatus: lockStatus || "active",
      rate,
      providerFeeMinor,
      crossBorderFeeMinor,
      fxFeeMinor,
    },
  };
}

export function mergeStoredQuoteSnapshot(previous: string, nextRate: string): string {
  const prev = parseQuoteSnapshot(previous);
  if (!prev) return nextRate.slice(0, 64);
  return JSON.stringify({
    ...prev,
    rate: nextRate ? nextRate.slice(0, 64) : prev.rate,
  });
}

export function assessAttemptPreservation(opts: {
  status: string;
  failureCode: string;
  failureMessage: string;
  fxRateSnapshot: string;
  stripeOutboundPaymentId: string;
  initiatedAt: Date | null;
  baseIdempotencyKey: string;
  nowMs: number;
}): { preserve: false } | { preserve: true; code: string; nextIdempotencyKey: string | null } {
  if (opts.stripeOutboundPaymentId) {
    return { preserve: true, code: "GP_PAYMENT_IN_FLIGHT", nextIdempotencyKey: null };
  }
  if (opts.status === "PROCESSING") {
    return { preserve: true, code: "GP_PAYMENT_IN_FLIGHT", nextIdempotencyKey: null };
  }
  if (opts.failureCode === "GP_PAYMENT_OUTCOME_UNCERTAIN") {
    return { preserve: true, code: "GP_PAYMENT_OUTCOME_UNCERTAIN", nextIdempotencyKey: null };
  }
  if (opts.initiatedAt && opts.status === "PENDING") {
    return { preserve: true, code: "GP_PAYMENT_OUTCOME_UNCERTAIN", nextIdempotencyKey: null };
  }
  const snap = parseQuoteSnapshot(opts.fxRateSnapshot);
  if (snap && Date.parse(snap.expiresAt) <= opts.nowMs) {
    return {
      preserve: true,
      code: "GP_QUOTE_EXPIRED",
      nextIdempotencyKey: correctedQuoteRetryKey(opts.baseIdempotencyKey),
    };
  }
  const signal = `${opts.failureCode} ${opts.failureMessage}`.toLowerCase();
  if (
    opts.status === "FAILED" &&
    !snap?.quoteId &&
    (signal.includes("quote is required") ||
      signal.includes("outbound_payment_quote") ||
      signal.includes("quote_missing"))
  ) {
    return {
      preserve: true,
      code: "GP_FAILED_ATTEMPT_PRESERVED",
      nextIdempotencyKey: correctedQuoteRetryKey(opts.baseIdempotencyKey),
    };
  }
  return { preserve: false };
}

export async function executeQuotedPayout(opts: {
  sourceAmountMinor: number;
  sourceCurrency: string;
  destinationCurrency: string;
  financialAccountId: string;
  recipientId: string;
  payoutMethodId: string;
  paymentIdempotencyKey: string;
  metadata: Record<string, string>;
  mode: "TEST" | "LIVE";
  nowMs: number;
  storedSnapshot: string;
  post: (req: {
    path: string;
    idempotencyKey: string;
    body: Record<string, unknown>;
  }) => Promise<QuoteHttpResult>;
  persistQuote: (snapshot: QuoteSnapshot) => Promise<void>;
  markPaymentSubmission: () => Promise<void>;
}): Promise<
  | { ok: true; body: Record<string, unknown>; quoteUsed: boolean }
  | { ok: false; code: string; parsed: GpProviderError | null; uncertain: boolean }
> {
  const source = opts.sourceCurrency.toLowerCase();
  const destination = opts.destinationCurrency.toLowerCase();
  const needsQuote = quoteRequired(source, destination);
  let quoteId = "";

  if (needsQuote) {
    const stored = parseQuoteSnapshot(opts.storedSnapshot);
    if (stored) {
      if (
        stored.sourceAmountMinor !== opts.sourceAmountMinor ||
        stored.sourceCurrency !== source ||
        stored.destinationCurrency !== destination ||
        Date.parse(stored.expiresAt) <= opts.nowMs
      ) {
        return {
          ok: false,
          code: Date.parse(stored.expiresAt) <= opts.nowMs ? "GP_QUOTE_EXPIRED" : "GP_QUOTE_MISMATCH",
          parsed: null,
          uncertain: false,
        };
      }
      quoteId = stored.quoteId;
    } else {
      let quoted: QuoteHttpResult;
      try {
        quoted = await opts.post({
          path: OUTBOUND_PAYMENT_QUOTE_PATH,
          idempotencyKey: quoteIdempotencyKey(opts.paymentIdempotencyKey),
          body: buildQuoteBody({
            financialAccountId: opts.financialAccountId,
            recipientId: opts.recipientId,
            payoutMethodId: opts.payoutMethodId,
            sourceAmountMinor: opts.sourceAmountMinor,
            sourceCurrency: source,
            destinationCurrency: destination,
          }),
        });
      } catch {
        return { ok: false, code: "GP_PAYMENT_OUTCOME_UNCERTAIN", parsed: null, uncertain: true };
      }
      if (!quoted.ok) {
        const parsed = parseGpProviderError(quoted);
        const uncertain = providerOutcomeUncertain(quoted.status, false);
        return {
          ok: false,
          code: uncertain ? "GP_PAYMENT_OUTCOME_UNCERTAIN" : parsed.code || "GP_QUOTE_FAILED",
          parsed,
          uncertain,
        };
      }
      const validated = validateOutboundQuote({
        body: quoted.body,
        financialAccountId: opts.financialAccountId,
        recipientId: opts.recipientId,
        payoutMethodId: opts.payoutMethodId,
        sourceAmountMinor: opts.sourceAmountMinor,
        sourceCurrency: source,
        destinationCurrency: destination,
        mode: opts.mode,
        nowMs: opts.nowMs,
      });
      if (!validated.ok) {
        return { ok: false, code: validated.code, parsed: null, uncertain: false };
      }
      await opts.persistQuote(validated.snapshot);
      quoteId = validated.snapshot.quoteId;
    }
  }

  await opts.markPaymentSubmission();
  let created: QuoteHttpResult;
  try {
    created = await opts.post({
      path: OUTBOUND_PAYMENT_PATH,
      idempotencyKey: opts.paymentIdempotencyKey,
      body: needsQuote
        ? buildQuotedPaymentBody({
            financialAccountId: opts.financialAccountId,
            recipientId: opts.recipientId,
            payoutMethodId: opts.payoutMethodId,
            sourceAmountMinor: opts.sourceAmountMinor,
            sourceCurrency: source,
            destinationCurrency: destination,
            quoteId,
            metadata: opts.metadata,
          })
        : buildSameCurrencyPaymentBody({
            financialAccountId: opts.financialAccountId,
            recipientId: opts.recipientId,
            payoutMethodId: opts.payoutMethodId,
            sourceAmountMinor: opts.sourceAmountMinor,
            sourceCurrency: source,
            metadata: opts.metadata,
          }),
    });
  } catch {
    return { ok: false, code: "GP_PAYMENT_OUTCOME_UNCERTAIN", parsed: null, uncertain: true };
  }
  if (!created.ok) {
    const parsed = parseGpProviderError(created);
    const uncertain = providerOutcomeUncertain(created.status, false);
    return {
      ok: false,
      code: uncertain ? "GP_PAYMENT_OUTCOME_UNCERTAIN" : parsed.code || "GP_OUTBOUND_CREATE_FAILED",
      parsed,
      uncertain,
    };
  }
  const outboundId = typeof created.body.id === "string" ? created.body.id : "";
  if (!outboundId) {
    return { ok: false, code: "GP_PAYMENT_OUTCOME_UNCERTAIN", parsed: parseGpProviderError(created), uncertain: true };
  }
  return { ok: true, body: created.body, quoteUsed: needsQuote };
}
