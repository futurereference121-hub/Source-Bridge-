/**
 * Move one Global Payouts charge's available net into the financial account,
 * then resume an already authorized payout. No simulated balance credit is accepted.
 */

import { prisma } from "@/lib/db";
import { canInitiateGlobalPayoutsMoney } from "@/lib/payments/payout-rail/eligibility";
import {
  getGlobalPayoutsFinancialAccountId,
  gpFetch,
  STRIPE_GP_API_VERSION,
} from "@/lib/payments/payout-rail/gp-client";
import {
  quotedPayoutCover,
  recordedInspectionDeadlineAllowsRelease,
} from "@/lib/payments/payout-rail/live-pilot";
import {
  evaluateQuoteRoute,
  financialAccountCountry,
  parseQuoteSnapshot,
  payoutMethodCountry,
  payoutMethodCurrencies,
  prepareQuoteOnly,
  resolveDestinationCurrency,
} from "@/lib/payments/payout-rail/outbound-quote";
import { gpQuoteConfirmationRequired } from "@/lib/payments/payout-rail/quote-confirmation";
import {
  allocateGpProceedsFunding,
  assessChargeSettlement,
  automaticBankPayoutBlocksFunding,
  classifyStoredQuote,
  completedPurchaseBlocksNewFunding,
  decideFundingRequest,
  describeGpBuyerPayout,
  fundingPayoutMatchesLeg,
  GP_COMPLETED_OUTBOUND_STATUSES,
  GP_FUNDING_WAITING_CODES,
  matchFundingCredit,
  nextFundingLegSequence,
  planProceedsAfterQuote,
  scheduleBlocksBuyerFunding,
  type ChargeSettlementInput,
  type GpBuyerPayoutProgress,
} from "@/lib/payments/payout-rail/proceeds-funding";
import { getStripe } from "@/lib/payments/stripe/client";
import {
  isGlobalPayoutsProceedsFundingEnabled,
  normalizeStripeMode,
  type StripeMode,
} from "@/lib/payments/flags";

const WAITING = GP_FUNDING_WAITING_CODES;

function feeMinor(snapshotRaw: string, principal: number, currency: string): number {
  const snapshot = parseQuoteSnapshot(snapshotRaw);
  if (!snapshot) return 0;
  const cover = quotedPayoutCover({
    principalMinor: principal,
    sourceCurrency: currency,
    providerFeeMinor: snapshot.providerFeeMinor,
    crossBorderFeeMinor: snapshot.crossBorderFeeMinor,
    fxFeeMinor: snapshot.fxFeeMinor,
    providerFeeCurrency: snapshot.providerFeeCurrency || "",
    crossBorderFeeCurrency: snapshot.crossBorderFeeCurrency || "",
    fxFeeCurrency: snapshot.fxFeeCurrency || "",
  });
  return cover.ok ? cover.separateFeeMinor : 0;
}

function settlementFromCharge(charge: {
  id: string;
  livemode: boolean;
  currency: string;
  amount: number;
  amount_refunded: number;
  balance_transaction?: unknown;
}): ChargeSettlementInput {
  const bt =
    charge.balance_transaction && typeof charge.balance_transaction === "object"
      ? (charge.balance_transaction as {
          id?: string;
          net?: number;
          currency?: string;
          status?: string;
          available_on?: number;
        })
      : null;
  return {
    chargeId: charge.id,
    livemode: charge.livemode,
    currency: (bt?.currency || charge.currency || "").toUpperCase(),
    grossMinor: charge.amount,
    refundedMinor: charge.amount_refunded,
    netMinor: typeof bt?.net === "number" ? bt.net : -1,
    balanceStatus: bt?.status || "unknown",
    availableOn: typeof bt?.available_on === "number" ? new Date(bt.available_on * 1000) : null,
  };
}

async function platformRoom(mode: StripeMode, currency: string, exceptFundingId: string) {
  const stripe = getStripe(mode);
  const balance = await stripe.balance.retrieve();
  const row = balance.available.find((entry) => entry.currency === currency.toLowerCase());
  const card =
    row && "source_types" in row && row.source_types && typeof row.source_types.card === "number"
      ? row.source_types.card
      : row?.amount ?? 0;
  const [transfers, legs] = await Promise.all([
    prisma.transferAttempt.aggregate({
      where: { status: "PENDING", currency: currency.toUpperCase(), stripeMode: mode },
      _sum: { amountMinor: true },
    }),
    prisma.gpProceedsFundingLeg.aggregate({
      where: {
        status: "PENDING",
        currency: currency.toUpperCase(),
        fundingId: { not: exceptFundingId },
        funding: { stripeMode: mode },
      },
      _sum: { amountMinor: true },
    }),
  ]);
  return {
    platformAvailableMinor: card,
    reservedMinor: (transfers._sum.amountMinor ?? 0) + (legs._sum.amountMinor ?? 0),
  };
}

export async function reconcileGpProceedsFunding(opts: {
  stripeMode: StripeMode;
  limit?: number;
  now?: Date;
  protectedTxnId?: string;
  /** Buyer click resumes through its own release call. Cron and webhooks resume here. */
  resumeAuthorized?: boolean;
}): Promise<{ scanned: number; funded: number; resumed: number }> {
  if (!isGlobalPayoutsProceedsFundingEnabled() || !canInitiateGlobalPayoutsMoney(opts.stripeMode)) {
    return { scanned: 0, funded: 0, resumed: 0 };
  }
  const mode = normalizeStripeMode(opts.stripeMode);
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 25;
  const txns = await prisma.protectedTransaction.findMany({
    where: {
      payoutRail: "STRIPE_GLOBAL_PAYOUTS",
      stripeMode: mode,
      fundedAt: { not: null },
      stripeChargeId: { not: "" },
      status: { notIn: ["REFUNDED", "CANCELLED", "FAILED"] },
      OR: [
        {
          status: { not: "RELEASED" },
          outboundPaymentAttempts: {
            none: { status: { in: [...GP_COMPLETED_OUTBOUND_STATUSES] } },
          },
        },
        { gpProceedsFunding: { legs: { some: { status: "PENDING" } } } },
      ],
      ...(opts.protectedTxnId ? { id: opts.protectedTxnId } : {}),
    },
    orderBy: { fundedAt: "asc" },
    take: limit,
    include: {
      gpProceedsFunding: { include: { legs: true } },
      outboundPaymentAttempts: { orderBy: { updatedAt: "desc" }, take: 1 },
      disputes: { where: { status: { in: ["OPEN", "UNDER_REVIEW"] } }, select: { id: true }, take: 1 },
    },
  });
  let funded = 0;
  let resumed = 0;
  for (const txn of txns) {
    try {
    const attempts = txn.outboundPaymentAttempts ?? [];
    const principal = txn.itemCostMinor + txn.shippingMinor + txn.sellerServiceFeeMinor;
    const fees = feeMinor(attempts[0]?.fxRateSnapshot || "", principal, txn.currency);
    const funding = await prisma.gpProceedsFunding.upsert({
      where: { protectedTxnId: txn.id },
      create: {
        protectedTxnId: txn.id,
        stripeMode: mode,
        currency: txn.currency.toUpperCase(),
        chargeId: txn.stripeChargeId,
        principalMinor: principal,
        payoutFeeMinor: fees,
        status: "AWAITING_SETTLEMENT",
      },
      update: { payoutFeeMinor: fees, principalMinor: principal, chargeId: txn.stripeChargeId },
      include: { legs: true },
    });
    const moved = await fundOne({
      txn,
      funding,
      principal,
      fees,
      mode,
      now,
      openDispute: (txn.disputes ?? []).length > 0,
    });
    if (moved) funded += 1;
    if (opts.resumeAuthorized !== false && (await resumeOne(txn.id, mode))) resumed += 1;
    } catch (err) {
      console.error(
        "[gp-proceeds-funding]",
        err instanceof Error ? `${err.name}: ${err.message}` : "error",
      );
    }
  }
  return { scanned: txns.length, funded, resumed };
}

async function buyerReleaseMayFund(
  txn: { id: string; buyerId: string; inspectionEndsAt: Date | null },
  now: Date,
): Promise<boolean> {
  const audits = await prisma.financialAuditEvent.findMany({
    where: {
      protectedTxnId: txn.id,
      actorUserId: txn.buyerId,
      action: { in: ["BUYER_RELEASE_NOW", "START_INSPECTION"] },
    },
    select: { action: true, metaJson: true },
    orderBy: { createdAt: "desc" },
  });
  if (audits.some((row) => row.action === "BUYER_RELEASE_NOW")) return true;
  const inspection = audits.find((row) => row.action === "START_INSPECTION");
  if (!inspection) return false;
  let recorded = "";
  try {
    const parsed = JSON.parse(inspection.metaJson || "{}") as { inspectionEndsAt?: unknown };
    recorded = typeof parsed.inspectionEndsAt === "string" ? parsed.inspectionEndsAt : "";
  } catch {
    recorded = "";
  }
  return recordedInspectionDeadlineAllowsRelease({
    nowMs: now.getTime(),
    recordedEndsAtIso: recorded,
    transactionEndsAtMs: txn.inspectionEndsAt ? txn.inspectionEndsAt.getTime() : null,
  }).ok;
}

/**
 * Re-read release status and seller payout state while the purchase row is locked.
 * A completed purchase stays ineligible for a new quote or funding payout.
 * This does not change the payout schedule and does not call Stripe.
 */
async function newFundingAllowedNow(txnId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ status: string }>>`
      SELECT "status" FROM "ProtectedTransaction" WHERE "id" = ${txnId} FOR UPDATE
    `;
    if (locked.length !== 1) return false;
    const attempts = await tx.outboundPaymentAttempt.findMany({
      where: { protectedTxnId: txnId },
      select: { status: true },
    });
    return !completedPurchaseBlocksNewFunding({
      txnStatus: locked[0]?.status || "",
      outboundStatuses: attempts.map((row) => row.status),
    });
  });
}

async function readPayoutInterval(mode: StripeMode): Promise<string | null> {
  try {
    const account = await getStripe(mode).accounts.retrieve();
    const interval = account.settings?.payouts?.schedule?.interval;
    return typeof interval === "string" ? interval : null;
  } catch {
    return null;
  }
}

async function listFundingPayoutIds(
  mode: StripeMode,
  leg: { id: string; amountMinor: number; currency: string; createdAt: Date },
  financialAccountId: string,
): Promise<string[]> {
  const stripe = getStripe(mode);
  const createdGte = Math.floor(leg.createdAt.getTime() / 1000) - 3600;
  const ids: string[] = [];
  let startingAfter = "";
  for (let page = 0; page < 5; page += 1) {
    const list = await stripe.payouts.list({
      created: { gte: createdGte },
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const payout of list.data) {
      const method = (payout as { payout_method?: string | null }).payout_method || "";
      if (
        fundingPayoutMatchesLeg(
          {
            id: payout.id,
            amount: payout.amount,
            currency: payout.currency,
            metadata: payout.metadata,
            payoutMethod: method,
            automatic: payout.automatic,
          },
          leg,
          financialAccountId,
        )
      ) {
        ids.push(payout.id);
      }
    }
    if (!list.has_more || list.data.length === 0) break;
    startingAfter = list.data[list.data.length - 1]?.id || "";
    if (!startingAfter) break;
  }
  return ids;
}

async function markFundingUncertain(fundingId: string, legId: string) {
  await prisma.gpProceedsFundingLeg.update({
    where: { id: legId },
    data: {
      status: "PENDING",
      failureCode: "GP_FUNDING_OUTCOME_UNCERTAIN",
      failureMessage: "The funding payout response was not saved. The same request stays open.",
    },
  });
  await prisma.gpProceedsFunding.update({
    where: { id: fundingId },
    data: { status: "FUNDING", failureCode: "GP_FUNDING_OUTCOME_UNCERTAIN" },
  });
}

async function sendFundingPayout(opts: {
  mode: StripeMode;
  fundingId: string;
  txnId: string;
  leg: { id: string; sequence: number; amountMinor: number; idempotencyKey: string };
  currency: string;
  financialAccountId: string;
}) {
  const stripe = getStripe(opts.mode);
  try {
    const payout = await stripe.payouts.create(
      {
        amount: opts.leg.amountMinor,
        currency: opts.currency.toLowerCase(),
        payout_method: opts.financialAccountId,
        source_type: "card",
        description: `sb-proceeds ${opts.leg.id}`,
        metadata: { sb_funding_leg: opts.leg.id, sb_protected_txn: opts.txnId },
      },
      {
        idempotencyKey: opts.leg.idempotencyKey,
        apiVersion: STRIPE_GP_API_VERSION,
      },
    );
    await prisma.gpProceedsFundingLeg.update({
      where: { id: opts.leg.id },
      data: { stripePayoutId: payout.id, stripePayoutStatus: payout.status, failureCode: "" },
    });
    await prisma.gpProceedsFunding.update({
      where: { id: opts.fundingId },
      data: { status: "FUNDING", failureCode: "" },
    });
    return true;
  } catch {
    await markFundingUncertain(opts.fundingId, opts.leg.id);
    return false;
  }
}

async function prepareFundingQuote(opts: {
  txn: {
    id: string;
    currency: string;
    sellerGpRecipientId: string;
    sellerGpPayoutMethodId: string;
    termsHash: string;
  };
  fundingId: string;
  attempt: { id: string; fxRateSnapshot: string };
  mode: StripeMode;
  principal: number;
  nowMs: number;
}): Promise<{ ok: true; fees: number; waived: boolean } | { ok: false; code: string }> {
  if (gpQuoteConfirmationRequired(opts.mode, "STRIPE_GLOBAL_PAYOUTS")) {
    return { ok: false, code: "GP_QUOTE_REVIEW_REQUIRED" };
  }
  const faId = getGlobalPayoutsFinancialAccountId(opts.mode);
  if (!faId || !opts.txn.sellerGpRecipientId || !opts.txn.sellerGpPayoutMethodId) {
    return { ok: false, code: "GP_NOT_READY" };
  }
  const methodRes = await gpFetch({
    mode: opts.mode,
    method: "GET",
    path: `/v2/money_management/payout_methods/${encodeURIComponent(opts.txn.sellerGpPayoutMethodId)}`,
    stripeContext: opts.txn.sellerGpRecipientId,
  });
  if (!methodRes.ok) return { ok: false, code: "GP_PAYOUT_METHOD_UNREADABLE" };
  const mapped = await prisma.globalPayoutRecipient.findFirst({
    where: { stripeRecipientId: opts.txn.sellerGpRecipientId, stripeMode: opts.mode },
    select: { defaultCurrency: true },
  });
  const destination = resolveDestinationCurrency({
    supportedCurrencies: payoutMethodCurrencies(methodRes.body),
    mappedCurrency: mapped?.defaultCurrency,
  });
  if (!destination.ok) return { ok: false, code: destination.code };
  const faRes = await gpFetch({
    mode: opts.mode,
    method: "GET",
    path: `/v2/money_management/financial_accounts/${encodeURIComponent(faId)}`,
  });
  const route = evaluateQuoteRoute({
    methodReadOk: true,
    financialAccountReadOk: faRes.ok,
    financialAccountCountry: faRes.ok ? financialAccountCountry(faRes.body) : "",
    payoutMethodCountry: payoutMethodCountry(methodRes.body),
  });
  if (!route.ok) return { ok: false, code: route.code };
  if (!route.requiresQuote) return { ok: true, fees: 0, waived: true };
  const previous = parseQuoteSnapshot(opts.attempt.fxRateSnapshot);
  const desired = `gp_proceeds_quote_${opts.txn.id}_${previous?.quoteId || "initial"}`;
  const funding = await prisma.gpProceedsFunding.findUnique({
    where: { id: opts.fundingId },
    select: { quoteIdempotencyKey: true },
  });
  const storedKey = funding?.quoteIdempotencyKey || "";
  const keyWasReused = storedKey.startsWith(desired);
  const key = keyWasReused ? storedKey : `${desired}_n${opts.nowMs.toString(36)}`;
  if (!keyWasReused) {
    await prisma.gpProceedsFunding.update({
      where: { id: opts.fundingId },
      data: { quoteIdempotencyKey: key },
    });
  }
  const quoted = await prepareQuoteOnly({
    sourceAmountMinor: opts.principal,
    sourceCurrency: opts.txn.currency,
    destinationCurrency: destination.currency,
    financialAccountId: faId,
    recipientId: opts.txn.sellerGpRecipientId,
    payoutMethodId: opts.txn.sellerGpPayoutMethodId,
    quoteIdempotencyKey: key,
    mode: opts.mode,
    nowMs: opts.nowMs,
    post: (req) =>
      gpFetch({
        mode: opts.mode,
        method: "POST",
        path: req.path,
        moneyMutation: true,
        idempotencyKey: req.idempotencyKey,
        body: req.body,
      }),
  });
  if (!quoted.ok) {
    if (!quoted.uncertain && keyWasReused) {
      await prisma.gpProceedsFunding.update({
        where: { id: opts.fundingId },
        data: { quoteIdempotencyKey: `${desired}_n${opts.nowMs.toString(36)}` },
      });
    }
    return { ok: false, code: quoted.code };
  }
  const snapshot = {
    ...quoted.snapshot,
    transactionId: opts.txn.id,
    recipientId: opts.txn.sellerGpRecipientId,
    payoutMethodId: opts.txn.sellerGpPayoutMethodId,
    mode: opts.mode,
    termsHash: opts.txn.termsHash,
    createdIdempotencyKey: key,
  };
  const stored = await prisma.outboundPaymentAttempt.updateMany({
    where: {
      id: opts.attempt.id,
      fxRateSnapshot: opts.attempt.fxRateSnapshot || "",
      initiatedAt: null,
      stripeOutboundPaymentId: "",
    },
    data: {
      stripeFinancialAccountId: faId,
      destinationCurrency: snapshot.destinationCurrency.toUpperCase(),
      destinationAmountMinor: snapshot.destinationAmountMinor,
      providerFeeMinor: snapshot.providerFeeMinor,
      crossBorderFeeMinor: snapshot.crossBorderFeeMinor,
      fxFeeMinor: snapshot.fxFeeMinor,
      fxRateSnapshot: JSON.stringify(snapshot),
    },
  });
  if (stored.count !== 1) return { ok: false, code: "GP_PAYMENT_IN_FLIGHT" };
  return { ok: true, fees: feeMinor(JSON.stringify(snapshot), opts.principal, opts.txn.currency), waived: false };
}

async function fundOne(opts: {
  txn: {
    id: string;
    buyerId: string;
    status: string;
    currency: string;
    stripeChargeId: string;
    payoutRail: string;
    termsHash: string;
    sellerGpRecipientId: string;
    sellerGpPayoutMethodId: string;
    inspectionEndsAt: Date | null;
  };
  funding: {
    id: string;
    legs: {
      id: string;
      sequence: number;
      amountMinor: number;
      status: string;
      stripePayoutId: string;
      stripePayoutStatus: string;
      faCreditId: string;
      currency: string;
    }[];
  };
  principal: number;
  fees: number;
  mode: StripeMode;
  now: Date;
  openDispute: boolean;
}): Promise<boolean> {
  if (!isGlobalPayoutsProceedsFundingEnabled()) return false;
  if (!canInitiateGlobalPayoutsMoney(opts.mode)) {
    await prisma.gpProceedsFunding.update({
      where: { id: opts.funding.id },
      data: { status: "BLOCKED", failureCode: "GP_INITIATION_DISABLED" },
    });
    return false;
  }
  if (
    opts.openDispute ||
    ["REFUNDED", "PARTIALLY_REFUNDED", "CANCELLED", "FAILED", "DISPUTED"].includes(opts.txn.status)
  ) {
    await prisma.gpProceedsFunding.update({
      where: { id: opts.funding.id },
      data: { status: "BLOCKED", failureCode: "GP_FUNDING_NOT_ELIGIBLE" },
    });
    return false;
  }
  await confirmLegs(opts.funding.legs ?? [], opts.mode);
  const freshLegs = await prisma.gpProceedsFundingLeg.findMany({ where: { fundingId: opts.funding.id } });
  const postedMinor = freshLegs.filter((leg) => leg.status === "POSTED").reduce((sum, leg) => sum + leg.amountMinor, 0);
  const pendingLegs = freshLegs.filter((leg) => leg.status === "PENDING");
  const faId = getGlobalPayoutsFinancialAccountId(opts.mode);
  if (pendingLegs.length > 0) {
    const pending = pendingLegs[0];
    if (!faId) {
      await markFundingUncertain(opts.funding.id, pending.id);
      return false;
    }
    let matches: string[] = [];
    try {
      matches = pending.stripePayoutId ? [pending.stripePayoutId] : await listFundingPayoutIds(opts.mode, pending, faId);
    } catch {
      await markFundingUncertain(opts.funding.id, pending.id);
      return false;
    }
    const recovery = pending.stripePayoutId
      ? { action: "attach" as const, payoutId: pending.stripePayoutId }
      : decideFundingRequest({
          legExistedBeforeThisAttempt: true,
          ageMs: opts.now.getTime() - pending.createdAt.getTime(),
          matchingPayoutIds: matches,
        });
    if (recovery.action === "uncertain") {
      await markFundingUncertain(opts.funding.id, pending.id);
      return false;
    }
    if (recovery.action === "attach") {
      if (!pending.stripePayoutId) {
        await prisma.gpProceedsFundingLeg.update({
          where: { id: pending.id },
          data: { stripePayoutId: recovery.payoutId, failureCode: "" },
        });
      }
      await confirmLegs(
        freshLegs.map((leg) => (leg.id === pending.id ? { ...leg, stripePayoutId: recovery.payoutId } : leg)),
        opts.mode,
      );
      return false;
    }
    if (!(await newFundingAllowedNow(opts.txn.id))) return false;
    await sendFundingPayout({
      mode: opts.mode,
      fundingId: opts.funding.id,
      txnId: opts.txn.id,
      leg: pending,
      currency: opts.txn.currency,
      financialAccountId: faId,
    });
    return false;
  }
  if (!(await newFundingAllowedNow(opts.txn.id))) {
    await prisma.gpProceedsFunding.update({
      where: { id: opts.funding.id },
      data: { status: "BLOCKED", failureCode: "GP_FUNDING_ALREADY_COMPLETED" },
    });
    return false;
  }
  const stripe = getStripe(opts.mode);
  const charge = await stripe.charges.retrieve(opts.txn.stripeChargeId, {
    expand: ["balance_transaction"],
  });
  const settlement = assessChargeSettlement(
    settlementFromCharge({
      id: charge.id,
      livemode: charge.livemode,
      currency: charge.currency,
      amount: charge.amount,
      amount_refunded: charge.amount_refunded,
      balance_transaction: charge.balance_transaction,
    }),
    opts.mode,
  );
  const bt =
    charge.balance_transaction && typeof charge.balance_transaction === "object"
      ? charge.balance_transaction
      : null;
  if (bt && "id" in bt && bt.id) {
    await prisma.gpProceedsFunding.update({
      where: { id: opts.funding.id },
      data: {
        balanceTransactionId: bt.id,
        availableOn: "available_on" in bt && typeof bt.available_on === "number" ? new Date(bt.available_on * 1000) : null,
        chargeNetMinor: "net" in bt && typeof bt.net === "number" ? bt.net : 0,
      },
    });
  }
  if (!settlement.ok || !settlement.available || (settlement.availableOn && settlement.availableOn.getTime() > opts.now.getTime())) {
    await prisma.gpProceedsFunding.update({
      where: { id: opts.funding.id },
      data: {
        status: settlement.ok ? "AWAITING_SETTLEMENT" : "BLOCKED",
        failureCode: settlement.ok ? "GP_CHARGE_PENDING" : settlement.code,
      },
    });
    return false;
  }
  if (!(await buyerReleaseMayFund(opts.txn, opts.now))) return false;
  const attempt = await prisma.outboundPaymentAttempt.findFirst({
    where: { protectedTxnId: opts.txn.id, kind: "FINAL" },
    orderBy: { updatedAt: "desc" },
  });
  const storedQuote = parseQuoteSnapshot(attempt?.fxRateSnapshot || "");
  let fees = feeMinor(attempt?.fxRateSnapshot || "", opts.principal, opts.txn.currency);
  let quote = classifyStoredQuote({
    quoteConfirmationRequired: gpQuoteConfirmationRequired(opts.mode, opts.txn.payoutRail),
    quoteId: storedQuote?.quoteId || "",
    expiresAt: storedQuote?.expiresAt || "",
    confirmedByUserId: storedQuote?.confirmedByUserId || "",
    nowMs: opts.now.getTime(),
  });
  let quotePlan = planProceedsAfterQuote({
    quote,
    principalMinor: opts.principal,
    payoutFeeMinor: fees,
    chargeNetMinor: settlement.netMinor,
    postedMinor,
    pendingMinor: 0,
  });
  if (quotePlan.action === "prepare_quote") {
    if (!attempt || attempt.stripeOutboundPaymentId || attempt.initiatedAt) {
      await prisma.gpProceedsFunding.update({
        where: { id: opts.funding.id },
        data: { status: "BLOCKED", failureCode: "GP_QUOTE_REVIEW_REQUIRED" },
      });
      return false;
    }
    if (!(await newFundingAllowedNow(opts.txn.id))) {
      await prisma.gpProceedsFunding.update({
        where: { id: opts.funding.id },
        data: { status: "BLOCKED", failureCode: "GP_FUNDING_ALREADY_COMPLETED" },
      });
      return false;
    }
    const prepared = await prepareFundingQuote({
      txn: opts.txn,
      fundingId: opts.funding.id,
      attempt,
      mode: opts.mode,
      principal: opts.principal,
      nowMs: opts.now.getTime(),
    });
    if (!prepared.ok) {
      await prisma.gpProceedsFunding.update({
        where: { id: opts.funding.id },
        data: { status: "FUNDING", failureCode: prepared.code },
      });
      return false;
    }
    fees = prepared.fees;
    quote = "usable";
    quotePlan = planProceedsAfterQuote({
      quote,
      principalMinor: opts.principal,
      payoutFeeMinor: fees,
      chargeNetMinor: settlement.netMinor,
      postedMinor,
      pendingMinor: 0,
    });
  }
  if (quotePlan.action === "await_confirmation" || quotePlan.action === "prepare_quote") {
    await prisma.gpProceedsFunding.update({
      where: { id: opts.funding.id },
      data: { status: "BLOCKED", failureCode: "GP_QUOTE_REVIEW_REQUIRED" },
    });
    return false;
  }
  if (quotePlan.action === "wait_inflight") return false;
  if (quotePlan.action === "blocked" || quotePlan.action === "short") {
    await prisma.gpProceedsFunding.update({
      where: { id: opts.funding.id },
      data: {
        status: quotePlan.action === "blocked" ? "BLOCKED" : "SHORT",
        failureCode: quotePlan.action === "blocked" ? quotePlan.code : "GP_FUNDING_ROOM",
        payoutFeeMinor: fees,
      },
    });
    return false;
  }
  if (quotePlan.action === "complete") {
    await prisma.gpProceedsFunding.update({
      where: { id: opts.funding.id },
      data: { status: "POSTED", failureCode: "", payoutFeeMinor: fees },
    });
    return false;
  }
  const schedule = automaticBankPayoutBlocksFunding(await readPayoutInterval(opts.mode));
  if (schedule.blocked) {
    await prisma.gpProceedsFunding.update({
      where: { id: opts.funding.id },
      data: { status: "BLOCKED", failureCode: schedule.code },
    });
    return false;
  }
  if (!faId) {
    await prisma.gpProceedsFunding.update({
      where: { id: opts.funding.id },
      data: { status: "BLOCKED", failureCode: "GP_FA_NOT_CONFIGURED" },
    });
    return false;
  }
  const room = await platformRoom(opts.mode, opts.txn.currency, opts.funding.id);
  const decision = allocateGpProceedsFunding({
    payoutRail: opts.txn.payoutRail,
    stripeMode: opts.mode,
    initiationAllowed: true,
    currency: opts.txn.currency,
    principalMinor: opts.principal,
    payoutFeeMinor: fees,
    charge: settlement,
    postedMinor,
    pendingMinor: 0,
    platformAvailableMinor: room.platformAvailableMinor,
    reservedMinor: room.reservedMinor,
    otherInFlightMinor: 0,
    txnStatus: opts.txn.status,
    openDispute: opts.openDispute,
    now: opts.now,
  });
  if (decision.action !== "fund" || decision.amountMinor !== quotePlan.amountMinor) {
    const failureCode =
      decision.action === "fund"
        ? "GP_FUNDING_AMOUNT"
        : decision.action === "complete"
          ? "GP_FUNDING_AMOUNT"
          : decision.code;
    await prisma.gpProceedsFunding.update({
      where: { id: opts.funding.id },
      data: {
        status: decision.action === "blocked" ? "BLOCKED" : decision.action === "wait" ? decision.status : "BLOCKED",
        failureCode,
        payoutFeeMinor: fees,
      },
    });
    return false;
  }
  const sequencePlan = nextFundingLegSequence(opts.txn.id, freshLegs);
  if (sequencePlan.action === "wait") return false;
  const existingLeg = await prisma.gpProceedsFundingLeg.findUnique({
    where: { idempotencyKey: sequencePlan.idempotencyKey },
  });
  let leg = existingLeg;
  if (!leg) {
    try {
      leg = await prisma.gpProceedsFundingLeg.create({
        data: {
          fundingId: opts.funding.id,
          sequence: sequencePlan.sequence,
          amountMinor: decision.amountMinor,
          currency: opts.txn.currency.toUpperCase(),
          idempotencyKey: sequencePlan.idempotencyKey,
          status: "PENDING",
        },
      });
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
      if (code !== "P2002") throw err;
      leg = await prisma.gpProceedsFundingLeg.findUnique({
        where: { idempotencyKey: sequencePlan.idempotencyKey },
      });
      if (!leg) return false;
    }
  }
  if (leg.amountMinor !== decision.amountMinor || leg.stripePayoutId) return false;
  let matching: string[] = [];
  if (existingLeg) {
    try {
      matching = await listFundingPayoutIds(opts.mode, leg, faId);
    } catch {
      await markFundingUncertain(opts.funding.id, leg.id);
      return false;
    }
  }
  const request = decideFundingRequest({
    legExistedBeforeThisAttempt: Boolean(existingLeg),
    ageMs: opts.now.getTime() - leg.createdAt.getTime(),
    matchingPayoutIds: matching,
  });
  if (request.action === "attach") {
    await prisma.gpProceedsFundingLeg.update({
      where: { id: leg.id },
      data: { stripePayoutId: request.payoutId, failureCode: "" },
    });
    return false;
  }
  if (request.action !== "create_same_key") {
    await markFundingUncertain(opts.funding.id, leg.id);
    return false;
  }
  if (!(await newFundingAllowedNow(opts.txn.id))) return false;
  return sendFundingPayout({
    mode: opts.mode,
    fundingId: opts.funding.id,
    txnId: opts.txn.id,
    leg,
    currency: opts.txn.currency,
    financialAccountId: faId,
  });
}

async function confirmLegs(
  legs: { id: string; amountMinor: number; currency: string; stripePayoutId: string; status: string }[],
  mode: StripeMode,
) {
  const pending = legs.filter((leg) => leg.status === "PENDING" && leg.stripePayoutId);
  if (pending.length === 0) return;
  const stripe = getStripe(mode);
  const listed = await gpFetch({
    mode,
    method: "GET",
    path: "/v2/money_management/received_credits?limit=20",
  });
  const credits = listed.ok && Array.isArray(listed.body.data) ? (listed.body.data as Record<string, unknown>[]) : [];
  const claimed = (
    await prisma.gpProceedsFundingLeg.findMany({
      where: { faCreditId: { not: "" } },
      select: { faCreditId: true },
    })
  ).map((row) => row.faCreditId);
  for (const leg of pending) {
    const payout = await stripe.payouts.retrieve(leg.stripePayoutId);
    if (payout.status === "failed" || payout.status === "canceled") {
      await prisma.gpProceedsFundingLeg.update({
        where: { id: leg.id },
        data: {
          status: "FAILED",
          stripePayoutStatus: payout.status,
          failureCode: payout.failure_code || "GP_FUNDING_PAYOUT_FAILED",
          failureMessage: (payout.failure_message || "").slice(0, 200),
        },
      });
      continue;
    }
    const match = matchFundingCredit({
      payoutId: payout.id,
      financialAccountId: getGlobalPayoutsFinancialAccountId(mode),
      amountMinor: leg.amountMinor,
      currency: leg.currency,
      payoutStatus: payout.status,
      livemode: mode === "LIVE",
      credits,
      claimedCreditIds: claimed,
    });
    if (!match) {
      await prisma.gpProceedsFundingLeg.update({
        where: { id: leg.id },
        data: { stripePayoutStatus: payout.status },
      });
      continue;
    }
    claimed.push(match.creditId);
    await prisma.gpProceedsFundingLeg.update({
      where: { id: leg.id },
      data: { status: "POSTED", stripePayoutStatus: payout.status, faCreditId: match.creditId, postedAt: new Date() },
    });
  }
}

async function resumeOne(protectedTxnId: string, mode: StripeMode): Promise<boolean> {
  const txn = await prisma.protectedTransaction.findUnique({
    where: { id: protectedTxnId },
    include: { gpProceedsFunding: { include: { legs: true } }, outboundPaymentAttempts: { take: 1, orderBy: { updatedAt: "desc" } } },
  });
  if (!txn || txn.status !== "READY_TO_RELEASE" || txn.payoutRail !== "STRIPE_GLOBAL_PAYOUTS") return false;
  const funding = txn.gpProceedsFunding;
  if (!funding || funding.status !== "POSTED") return false;
  const principal = txn.itemCostMinor + txn.shippingMinor + txn.sellerServiceFeeMinor;
  const fees = feeMinor(txn.outboundPaymentAttempts[0]?.fxRateSnapshot || "", principal, txn.currency);
  const posted = funding.legs.filter((leg) => leg.status === "POSTED").reduce((sum, leg) => sum + leg.amountMinor, 0);
  const pending = funding.legs.filter((leg) => leg.status === "PENDING").reduce((sum, leg) => sum + leg.amountMinor, 0);
  const storedQuote = parseQuoteSnapshot(txn.outboundPaymentAttempts[0]?.fxRateSnapshot || "");
  const quote = classifyStoredQuote({
    quoteConfirmationRequired: gpQuoteConfirmationRequired(txn.stripeMode, txn.payoutRail),
    quoteId: storedQuote?.quoteId || "",
    expiresAt: storedQuote?.expiresAt || "",
    confirmedByUserId: storedQuote?.confirmedByUserId || "",
    nowMs: Date.now(),
  });
  const quotePlan = planProceedsAfterQuote({
    quote,
    principalMinor: principal,
    payoutFeeMinor: fees,
    chargeNetMinor: funding.chargeNetMinor,
    postedMinor: posted,
    pendingMinor: pending,
  });
  if (quotePlan.action !== "complete") return false;
  if (posted < principal + fees) return false;
  const audit = await prisma.financialAuditEvent.findFirst({
    where: { protectedTxnId: txn.id, actorUserId: txn.buyerId, action: "BUYER_RELEASE_NOW" },
    select: { id: true },
  });
  if (!audit) return false;
  const { releaseFinal } = await import("@/lib/payments/release");
  try {
    await releaseFinal({
      protectedTxnId: txn.id,
      actorUserId: null,
      backgroundRelease: {
        buyerId: txn.buyerId,
        action: "BUYER_RELEASE_NOW",
        purpose: "AUTHORIZED_RETRY",
      },
    });
    return true;
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
    if (WAITING.has(code)) return false;
    return false;
  }
}

export async function gpFundingBlocksRefund(protectedTxnId: string): Promise<boolean> {
  const count = await prisma.gpProceedsFundingLeg.count({
    where: { status: { in: ["PENDING", "POSTED"] }, funding: { protectedTxnId } },
  });
  return count > 0;
}

export async function gpPayoutProgressForTransaction(opts: {
  protectedTxnId: string | null;
  payoutRail: string | null;
  txnStatus: string | null;
  fundedAt: Date | null;
}): Promise<GpBuyerPayoutProgress | null> {
  if (opts.payoutRail !== "STRIPE_GLOBAL_PAYOUTS" || !opts.protectedTxnId) return null;
  const [funding, attempt] = await Promise.all([
    prisma.gpProceedsFunding.findUnique({ where: { protectedTxnId: opts.protectedTxnId } }),
    prisma.outboundPaymentAttempt.findFirst({
      where: { protectedTxnId: opts.protectedTxnId },
      orderBy: { updatedAt: "desc" },
      select: {
        status: true,
        failureCode: true,
        stripeOutboundPaymentId: true,
        expectedArrivalAt: true,
      },
    }),
  ]);
  const authorized =
    opts.txnStatus === "READY_TO_RELEASE" ||
    opts.txnStatus === "RELEASED" ||
    Boolean(attempt && attempt.status !== "FAILED");
  return describeGpBuyerPayout({
    releaseAuthorized: authorized,
    txnStatus: opts.txnStatus || "",
    outboundStatus: attempt?.status,
    outboundIdPresent: Boolean(attempt?.stripeOutboundPaymentId),
    failureCode: attempt?.failureCode,
    fundingStatus: funding?.status,
    proceedsFundingEnabled: isGlobalPayoutsProceedsFundingEnabled(),
    configurationBlocked: scheduleBlocksBuyerFunding(funding?.failureCode),
    chargeAvailable:
      funding?.status === "POSTED" ||
      funding?.status === "FUNDING" ||
      funding?.status === "SHORT" ||
      (funding?.availableOn != null && funding.availableOn.getTime() <= Date.now()),
    availableOn: funding?.availableOn,
    fundedAt: opts.fundedAt,
    expectedArrival: attempt?.expectedArrivalAt ?? null,
  });
}

export async function onPlatformBalanceAvailable(mode: StripeMode) {
  if (!isGlobalPayoutsProceedsFundingEnabled()) return { skipped: "proceeds_funding_disabled" as const };
  if (!canInitiateGlobalPayoutsMoney(mode)) return { skipped: "initiation_disabled" as const };
  return reconcileGpProceedsFunding({ stripeMode: mode });
}

export async function onPlatformPayoutEvent(opts: {
  mode: StripeMode;
  metadata?: { sb_funding_leg?: string } | null;
}) {
  if (!opts.metadata?.sb_funding_leg) return { ignored: true as const };
  if (!isGlobalPayoutsProceedsFundingEnabled()) return { skipped: "proceeds_funding_disabled" as const };
  if (!canInitiateGlobalPayoutsMoney(opts.mode)) return { skipped: "initiation_disabled" as const };
  return reconcileGpProceedsFunding({ stripeMode: opts.mode });
}

export function isGpFundingWaitingCode(code: string): boolean {
  return WAITING.has(code);
}
