/**
 * Buyer-visible Global Payouts estimate.
 * Preparation may create an OutboundPaymentQuote. It never creates an OutboundPayment.
 */

import { prisma } from "@/lib/db";
import {
  isGlobalPayoutsEnabled,
  normalizeStripeMode,
} from "@/lib/payments/flags";
import { computeProtectedFinancials } from "@/lib/payments/breakdown";
import { isDirectPaymentOption } from "@/lib/payments/payment-option";
import { lockedPayoutRailFromTxn } from "@/lib/payments/payout-rail/rail-resolver";
import {
  canInitiateGlobalPayoutsMoney,
  isGlobalPayoutsCountryAllowed,
} from "@/lib/payments/payout-rail/eligibility";
import {
  getGlobalPayoutsFinancialAccountId,
  gpFetch,
} from "@/lib/payments/payout-rail/gp-client";
import { readFinancialAccountBalance } from "@/lib/payments/payout-rail/fa-funding";
import {
  evaluateLivePilotInitiation,
  evaluateQuoteConfirmation,
  pilotFailureIsSticky,
  planQuotePreparation,
  PROVIDER_FEE_PAYER,
} from "@/lib/payments/payout-rail/live-pilot";
import { deriveOutboundDisplayState } from "@/lib/payments/payout-rail/outbound-display";
import {
  evaluateQuoteRoute,
  financialAccountCountry,
  parseQuoteSnapshot,
  payoutMethodCountry,
  payoutMethodCurrencies,
  prepareQuoteOnly,
  quoteIdempotencyKey,
  resolveDestinationCurrency,
  type QuoteSnapshot,
} from "@/lib/payments/payout-rail/outbound-quote";

const LOCAL_ESTIMATE_TTL_MS = 15 * 60 * 1000;

export type QuoteReviewView = {
  quoteId: string;
  confirmed: boolean;
  sourceAmountMinor: number;
  sourceCurrency: string;
  destinationAmountMinor: number;
  destinationCurrency: string;
  providerFeeMinor: number;
  providerFeeCurrency: string;
  crossBorderFeeMinor: number;
  crossBorderFeeCurrency: string;
  fxFeeMinor: number;
  fxFeeCurrency: string;
  feePayer: string;
  expiresAt: string;
  payoutLabel: string;
};

function payoutLabelFor(status: string, failureCode: string): string {
  if (!status) return "";
  const state = deriveOutboundDisplayState(status, failureCode);
  if (state.phase === "manual_review" || state.phase === "processing" || state.phase === "completed") {
    return state.buyerLabel;
  }
  return "";
}

function viewFromSnapshot(raw: string, status = "", failureCode = ""): QuoteReviewView | null {
  const snap = parseQuoteSnapshot(raw);
  if (!snap) return null;
  return {
    quoteId: snap.quoteId,
    confirmed: Boolean(snap.confirmedByUserId),
    sourceAmountMinor: snap.sourceAmountMinor,
    sourceCurrency: snap.sourceCurrency,
    destinationAmountMinor: snap.destinationAmountMinor,
    destinationCurrency: snap.destinationCurrency,
    providerFeeMinor: snap.providerFeeMinor,
    providerFeeCurrency: snap.providerFeeCurrency || "",
    crossBorderFeeMinor: snap.crossBorderFeeMinor,
    crossBorderFeeCurrency: snap.crossBorderFeeCurrency || "",
    fxFeeMinor: snap.fxFeeMinor,
    fxFeeCurrency: snap.fxFeeCurrency || "",
    feePayer: snap.feePayer || PROVIDER_FEE_PAYER,
    expiresAt: snap.expiresAt,
    payoutLabel: payoutLabelFor(status, failureCode),
  };
}

function releaseAmount(
  txn: {
    currency: string;
    itemCostMinor: number;
    shippingMinor: number;
    sellerServiceFeeMinor: number;
    protectionFeeMinor: number;
    totalChargeMinor: number;
    procurementAdvanceAgreed: boolean;
    procurementAdvanceMinor: number;
    procurementTransferredMinor: number;
    finalTransferredMinor: number;
    refundedMinor: number;
  },
  kind: "FINAL" | "PROCUREMENT",
): number {
  const books = computeProtectedFinancials(txn);
  if (kind === "PROCUREMENT") {
    return Math.max(0, books.procurementAdvanceMinor - books.procurementTransferredMinor);
  }
  return books.finalResidualMinor;
}

function pilotEnv() {
  return {
    userAllowlistRaw: process.env.GLOBAL_PAYOUTS_USER_ALLOWLIST || "",
    configuredSourceCurrencyRaw: process.env.GLOBAL_PAYOUTS_LIVE_PILOT_SOURCE_CURRENCY || "",
    amountCapRaw: process.env.GLOBAL_PAYOUTS_LIVE_PILOT_AMOUNT_CAP_MINOR || "",
    authorizedTransactionIdRaw: process.env.GLOBAL_PAYOUTS_LIVE_PILOT_TRANSACTION_ID || "",
    destinationMinimumsRaw: process.env.GLOBAL_PAYOUTS_LIVE_DESTINATION_MINIMUMS || "",
  };
}

export async function reviewGlobalPayoutQuote(opts: {
  actorUserId: string;
  protectedTxnId: string;
  kind: "FINAL" | "PROCUREMENT";
  action: "status" | "prepare" | "confirm";
  quoteId?: string;
}): Promise<{ ok: true; review: QuoteReviewView | null } | { ok: false; code: string; review?: QuoteReviewView | null }> {
  const txn = await prisma.protectedTransaction.findUnique({
    where: { id: opts.protectedTxnId },
  });
  if (!txn) return { ok: false, code: "NOT_FOUND" };
  if (opts.actorUserId !== txn.buyerId) return { ok: false, code: "GP_QUOTE_ACTOR_MISMATCH" };
  if (lockedPayoutRailFromTxn(txn) !== "STRIPE_GLOBAL_PAYOUTS") {
    return { ok: false, code: "PAYOUT_RAIL_MISMATCH" };
  }
  if (isDirectPaymentOption(txn.paymentOption)) {
    return { ok: false, code: "DIRECT_NO_PLATFORM_TRANSFER" };
  }
  if (!txn.sellerGpRecipientId || !txn.sellerGpPayoutMethodId) {
    return { ok: false, code: "GP_NOT_READY" };
  }

  const txnMode = normalizeStripeMode(txn.stripeMode);
  const amount = releaseAmount(txn, opts.kind);
  if (amount <= 0) return { ok: false, code: "RELEASE_EXCEEDS_RESIDUAL" };
  const idempotencyKey =
    opts.kind === "PROCUREMENT"
      ? `proc_gp_${txn.id}_${txn.termsHash}`
      : `final_gp_${txn.id}_${txn.termsHash}`;

  const existing = await prisma.outboundPaymentAttempt.findUnique({
    where: { idempotencyKey },
  });
  if (opts.action === "status") {
    return { ok: true, review: viewFromSnapshot(existing?.fxRateSnapshot || "", existing?.status || "", existing?.failureCode || "") };
  }

  if (
    existing?.stripeOutboundPaymentId ||
    existing?.initiatedAt ||
    existing?.status === "PROCESSING" ||
    pilotFailureIsSticky(existing?.failureCode)
  ) {
    return { ok: false, code: "GP_PAYMENT_IN_FLIGHT", review: viewFromSnapshot(existing?.fxRateSnapshot || "", existing?.status || "", existing?.failureCode || "") };
  }

  if (opts.action === "confirm") {
    const snap = parseQuoteSnapshot(existing?.fxRateSnapshot || "");
    if (!snap || !opts.quoteId || opts.quoteId !== snap.quoteId) {
      return { ok: false, code: "GP_QUOTE_MISMATCH", review: viewFromSnapshot(existing?.fxRateSnapshot || "", existing?.status || "", existing?.failureCode || "") };
    }
    const stamped: QuoteSnapshot = {
      ...snap,
      confirmedByUserId: opts.actorUserId,
    };
    const decision = evaluateQuoteConfirmation({
      stored: stamped,
      actorUserId: opts.actorUserId,
      transactionId: txn.id,
      mode: txnMode,
      recipientId: txn.sellerGpRecipientId,
      payoutMethodId: txn.sellerGpPayoutMethodId,
      sourceAmountMinor: amount,
      sourceCurrency: txn.currency,
      destinationCurrency: stamped.destinationCurrency,
      termsHash: txn.termsHash,
      nowMs: Date.now(),
    });
    if (!decision.ok) return { ok: false, code: decision.code, review: viewFromSnapshot(existing?.fxRateSnapshot || "", existing?.status || "", existing?.failureCode || "") };
    if (txnMode === "LIVE") {
      const blocked = await liveLimitDecision(txn, opts.actorUserId, amount, stamped);
      if (!blocked.ok) return { ok: false, code: blocked.code, review: viewFromSnapshot(JSON.stringify(stamped)) };
    }
    await prisma.outboundPaymentAttempt.update({
      where: { id: existing!.id },
      data: { fxRateSnapshot: JSON.stringify(stamped) },
    });
    return { ok: true, review: viewFromSnapshot(JSON.stringify(stamped)) };
  }

  const plan = planQuotePreparation({
    mode: txnMode,
    initiationEnabled: canInitiateGlobalPayoutsMoney(txnMode),
    requiresQuote: true,
  });
  if (!plan.ok) return { ok: false, code: plan.code };

  const faId = getGlobalPayoutsFinancialAccountId(txnMode);
  const methodRes = await gpFetch({
    mode: txnMode,
    method: "GET",
    path: `/v2/money_management/payout_methods/${encodeURIComponent(txn.sellerGpPayoutMethodId)}`,
    stripeContext: txn.sellerGpRecipientId,
  });
  if (!methodRes.ok) return { ok: false, code: "GP_PAYOUT_METHOD_UNREADABLE" };
  const mapped = await prisma.globalPayoutRecipient.findFirst({
    where: { stripeRecipientId: txn.sellerGpRecipientId, stripeMode: txnMode },
    select: { defaultCurrency: true },
  });
  const destination = resolveDestinationCurrency({
    supportedCurrencies: payoutMethodCurrencies(methodRes.body),
    mappedCurrency: mapped?.defaultCurrency,
  });
  if (!destination.ok) return { ok: false, code: destination.code };
  const faRes = faId
    ? await gpFetch({
        mode: txnMode,
        method: "GET",
        path: `/v2/money_management/financial_accounts/${encodeURIComponent(faId)}`,
      })
    : { ok: false as const, body: {} };
  const route = evaluateQuoteRoute({
    methodReadOk: true,
    financialAccountReadOk: Boolean(faRes.ok),
    financialAccountCountry: faRes.ok ? financialAccountCountry(faRes.body) : "",
    payoutMethodCountry: payoutMethodCountry(methodRes.body),
  });
  if (!route.ok) return { ok: false, code: route.code };

  const quotePlan = planQuotePreparation({
    mode: txnMode,
    initiationEnabled: canInitiateGlobalPayoutsMoney(txnMode),
    requiresQuote: route.requiresQuote,
  });
  if (!quotePlan.ok || quotePlan.paymentPath) {
    return { ok: false, code: quotePlan.ok ? "GP_QUOTE_FAILED" : quotePlan.code };
  }

  let snapshot: QuoteSnapshot;
  if (quotePlan.quotePath) {
    const prepared = await prepareQuoteOnly({
      sourceAmountMinor: amount,
      sourceCurrency: txn.currency,
      destinationCurrency: destination.currency,
      financialAccountId: faId,
      recipientId: txn.sellerGpRecipientId,
      payoutMethodId: txn.sellerGpPayoutMethodId,
      quoteIdempotencyKey: quoteIdempotencyKey(idempotencyKey),
      mode: txnMode,
      nowMs: Date.now(),
      assertBeforeProviderWrite: async () => {
        if (txnMode !== "LIVE") return;
        const gate = await liveLimitDecision(txn, opts.actorUserId, amount, {
          providerFeeMinor: 0,
          crossBorderFeeMinor: 0,
          fxFeeMinor: 0,
          providerFeeCurrency: txn.currency,
          crossBorderFeeCurrency: txn.currency,
          fxFeeCurrency: txn.currency,
          destinationAmountMinor: null,
          destinationCurrency: destination.currency,
        });
        if (!gate.ok) {
          throw Object.assign(new Error("Live pilot denied quote preparation."), {
            status: 409,
            code: gate.code,
          });
        }
      },
      post: async (req) => {
        if (req.path.includes("/outbound_payments") && !req.path.endsWith("outbound_payment_quotes")) {
          throw Object.assign(new Error("Quote preparation cannot create a payment."), {
            code: "GP_QUOTE_FAILED",
          });
        }
        return gpFetch({
          mode: txnMode,
          method: "POST",
          path: req.path,
          moneyMutation: true,
          idempotencyKey: req.idempotencyKey,
          body: req.body,
        });
      },
    });
    if (!prepared.ok) return { ok: false, code: prepared.code };
    snapshot = prepared.snapshot;
  } else {
    snapshot = {
      v: 1,
      quoteId: `local_no_provider_quote_${txn.id}`,
      sourceAmountMinor: amount,
      sourceCurrency: txn.currency.toLowerCase(),
      destinationCurrency: destination.currency.toLowerCase(),
      destinationAmountMinor: amount,
      expiresAt: new Date(Date.now() + LOCAL_ESTIMATE_TTL_MS).toISOString(),
      lockStatus: "local",
      rate: "",
      providerFeeMinor: 0,
      crossBorderFeeMinor: 0,
      fxFeeMinor: 0,
      providerFeeCurrency: txn.currency.toLowerCase(),
      crossBorderFeeCurrency: txn.currency.toLowerCase(),
      fxFeeCurrency: txn.currency.toLowerCase(),
      feePayer: PROVIDER_FEE_PAYER,
    };
  }

  const stored: QuoteSnapshot = {
    ...snapshot,
    transactionId: txn.id,
    recipientId: txn.sellerGpRecipientId,
    payoutMethodId: txn.sellerGpPayoutMethodId,
    mode: txnMode,
    termsHash: txn.termsHash,
    feePayer: PROVIDER_FEE_PAYER,
    confirmedByUserId: undefined,
  };
  if (txnMode === "LIVE") {
    const blocked = await liveLimitDecision(txn, opts.actorUserId, amount, stored);
    if (!blocked.ok) return { ok: false, code: blocked.code, review: viewFromSnapshot(JSON.stringify(stored)) };
  }

  const attempt =
    existing ||
    (await prisma.outboundPaymentAttempt.create({
      data: {
        protectedTxnId: txn.id,
        kind: opts.kind,
        amountMinor: amount,
        currency: txn.currency,
        stripeMode: txnMode,
        idempotencyKey,
        status: "PENDING",
        stripeRecipientId: txn.sellerGpRecipientId,
        stripePayoutMethodId: txn.sellerGpPayoutMethodId,
      },
    }));
  await prisma.outboundPaymentAttempt.update({
    where: { id: attempt.id },
    data: {
      amountMinor: amount,
      destinationCurrency: stored.destinationCurrency.toUpperCase(),
      destinationAmountMinor: stored.destinationAmountMinor,
      providerFeeMinor: stored.providerFeeMinor,
      crossBorderFeeMinor: stored.crossBorderFeeMinor,
      fxFeeMinor: stored.fxFeeMinor,
      fxRateSnapshot: JSON.stringify(stored),
      failureCode: existing?.failureCode === "GP_PILOT_SLOT" ? existing.failureCode : "",
    },
  });
  return { ok: true, review: viewFromSnapshot(JSON.stringify(stored)) };
}

async function liveLimitDecision(
  txn: {
    id: string;
    sellerId: string;
    buyerId: string;
    currency: string;
  },
  actorUserId: string,
  amount: number,
  snap: {
    providerFeeMinor: number;
    crossBorderFeeMinor: number;
    fxFeeMinor: number;
    providerFeeCurrency?: string;
    crossBorderFeeCurrency?: string;
    fxFeeCurrency?: string;
    destinationAmountMinor: number | null;
    destinationCurrency: string;
  },
): Promise<{ ok: true } | { ok: false; code: string }> {
  const seller = await prisma.user.findUnique({
    where: { id: txn.sellerId },
    select: { email: true, country: true },
  });
  const balance = await readFinancialAccountBalance("LIVE");
  const env = pilotEnv();
  const decision = evaluateLivePilotInitiation({
    mode: "LIVE",
    gpEnabled: isGlobalPayoutsEnabled(),
    userAllowlistRaw: env.userAllowlistRaw,
    userId: txn.sellerId,
    email: seller?.email ?? null,
    countryAllowed: isGlobalPayoutsCountryAllowed(seller?.country || ""),
    actorUserId,
    buyerId: txn.buyerId,
    sourceCurrency: txn.currency,
    configuredSourceCurrencyRaw: env.configuredSourceCurrencyRaw,
    amountCapRaw: env.amountCapRaw,
    principalMinor: amount,
    providerFeeMinor: snap.providerFeeMinor,
    crossBorderFeeMinor: snap.crossBorderFeeMinor,
    fxFeeMinor: snap.fxFeeMinor,
    providerFeeCurrency: snap.providerFeeCurrency || "",
    crossBorderFeeCurrency: snap.crossBorderFeeCurrency || "",
    fxFeeCurrency: snap.fxFeeCurrency || "",
    availableBalanceMinor: balance.availableMinor,
    destinationAmountMinor: snap.destinationAmountMinor,
    destinationCurrency: snap.destinationCurrency,
    destinationQuoted: snap.destinationAmountMinor != null,
    destinationMinimumsRaw: env.destinationMinimumsRaw,
    authorizedTransactionIdRaw: env.authorizedTransactionIdRaw,
    transactionId: txn.id,
  });
  return decision.ok ? { ok: true } : { ok: false, code: decision.code };
}
