/**
 * Run financial-account funding and the platform bank remainder under one lock
 * per Stripe mode and currency. Flags default off. This file never updates the
 * payout schedule and never accepts a bank destination from a caller.
 */

import { prisma } from "@/lib/db";
import { canInitiateGlobalPayoutsMoney } from "@/lib/payments/payout-rail/eligibility";
import { withPlatformBalanceLock, fencedProviderWrite } from "@/lib/payments/payout-rail/platform-balance-lock";
import {
  dailyScheduleRollbackDecision,
  manualScheduleCutoverDecision,
  nextBankRemainderAttempt,
  planSafeBankRemainder,
  platformBalanceHealth,
  PLATFORM_BALANCE_RESERVE_SCAN_CAP,
  assessPlatformBank,
  readPlatformExternalAccounts,
  reservePurchase,
  classifyCrossCurrencyReserve,
  bankCurrencies,
  listedBalanceCurrencies,
  settlementLiabilityCurrencies,
  type PurchaseLiability,
} from "@/lib/payments/payout-rail/platform-balance";
import { idHash8 } from "@/lib/payments/payout-rail/proceeds-preflight-shape";
import { applyOutstandingChargeSettlement } from "@/lib/payments/payout-rail/connect-settlement-amount";
import { retrieveOutstandingChargeSettlement } from "@/lib/payments/payout-rail/outstanding-charge-settlement";
import { decideFundingRequest } from "@/lib/payments/payout-rail/proceeds-funding";
import { reconcileGpProceedsFunding } from "@/lib/payments/payout-rail/proceeds-funding-run";
import { dashboardConfirmationForAccount, retrievedAccountLivemode } from "@/lib/payments/payout-rail/platform-bank-confirmation";
import { getStripe } from "@/lib/payments/stripe/client";
import {
  isGlobalPayoutsProceedsFundingEnabled,
  isPlatformBankRemainderPayoutEnabled,
  normalizeStripeMode,
  type StripeMode,
} from "@/lib/payments/flags";

const OPEN_BANK = ["PENDING", "UNCERTAIN"] as const;

async function readScheduleInterval(mode: StripeMode): Promise<{ interval: string | null; failed: boolean }> {
  try {
    const account = await getStripe(mode).accounts.retrieve();
    const interval = account.settings?.payouts?.schedule?.interval;
    if (typeof interval !== "string") return { interval: null, failed: true };
    return { interval, failed: false };
  } catch {
    return { interval: null, failed: true };
  }
}

async function readCardAvailable(mode: StripeMode, currency: string): Promise<number | null> {
  const balance = await getStripe(mode).balance.retrieve();
  if (balance.livemode !== (mode === "LIVE")) return null;
  // Pending is not available. A pending charge net cannot fund another obligation.
  const row = balance.available.find((entry) => entry.currency === currency.toLowerCase());
  const card = row && "source_types" in row ? row.source_types?.card : undefined;
  return typeof card === "number" ? card : null;
}

async function readPlatformBank(
  mode: StripeMode,
  currency: string,
): Promise<{
  verified: boolean;
  information: "unavailable" | "verified" | "unverified";
  failed: boolean;
  dashboardConfirmation: "recorded" | "absent";
}> {
  const stripe = getStripe(mode);
  const account = await stripe.accounts.retrieve();
  const assessment = assessPlatformBank(readPlatformExternalAccounts(account), {
    currency,
    livemode: mode === "LIVE",
  });
  let modeEvidenceLivemode: boolean | null = null;
  try {
    const balance = await stripe.balance.retrieve();
    if (typeof balance.livemode === "boolean" && balance.livemode === (mode === "LIVE")) {
      modeEvidenceLivemode = balance.livemode;
    }
  } catch {
    modeEvidenceLivemode = null;
  }
  const dashboardConfirmation = await dashboardConfirmationForAccount({
    stripeMode: mode,
    currency,
    accountId: account.id || "",
    accountLivemode: retrievedAccountLivemode(account),
    modeEvidenceLivemode,
  });
  return {
    verified: assessment.bankConfigurationVerified,
    information: assessment.bankInformation,
    failed: false,
    dashboardConfirmation,
  };
}

export async function loadPlatformLiabilities(mode: StripeMode): Promise<{
  purchases: PurchaseLiability[];
  scanComplete: boolean;
}> {
  const rows = await prisma.protectedTransaction.findMany({
    where: {
      stripeMode: mode,
      fundedAt: { not: null },
    },
    take: PLATFORM_BALANCE_RESERVE_SCAN_CAP + 1,
    orderBy: { fundedAt: "asc" },
    include: {
      gpProceedsFunding: { include: { legs: true } },
      outboundPaymentAttempts: { select: { status: true } },
      transferAttempts: { where: { status: "PENDING" }, select: { amountMinor: true } },
      disputes: { where: { status: { in: ["OPEN", "UNDER_REVIEW"] } }, select: { id: true }, take: 1 },
    },
  });
  const scanComplete = rows.length <= PLATFORM_BALANCE_RESERVE_SCAN_CAP;
  const limited = rows.slice(0, PLATFORM_BALANCE_RESERVE_SCAN_CAP);
  const purchases: PurchaseLiability[] = limited.map((row) => {
    const funding = row.gpProceedsFunding;
    const netKnown = Boolean(funding?.balanceTransactionId) || (funding?.chargeNetMinor ?? 0) > 0;
    const credited =
      funding?.legs.filter((leg) => leg.status === "POSTED").reduce((sum, leg) => sum + leg.amountMinor, 0) ?? 0;
    const pendingFunding =
      funding?.legs.filter((leg) => leg.status === "PENDING").reduce((sum, leg) => sum + leg.amountMinor, 0) ?? 0;
    return {
      stripeMode: mode,
      currency: row.currency,
      payoutRail: row.payoutRail,
      paymentOption: row.paymentOption,
      status: row.status,
      sellerEntitlementMinor: row.itemCostMinor + row.shippingMinor + row.sellerServiceFeeMinor,
      transferredMinor: row.procurementTransferredMinor + row.finalTransferredMinor,
      protectionFeeMinor: row.protectionFeeMinor,
      platformFeeRefundedMinor: row.platformFeeRefundedMinor,
      totalChargeMinor: row.totalChargeMinor,
      refundedMinor: row.refundedMinor,
      openDispute: row.disputes.length > 0,
      chargeNetMinor: netKnown ? (funding?.chargeNetMinor ?? null) : null,
      settlementCurrency: null,
      chargeAmountMinor: null,
      balanceTransactionAmountMinor: null,
      durablyCreditedMinor: credited,
      outboundStatuses: row.outboundPaymentAttempts.map((attempt) => attempt.status),
      pendingTransferMinor: row.transferAttempts.reduce((sum, attempt) => sum + attempt.amountMinor, 0),
      pendingFundingMinor: pendingFunding,
      purchaseHash: idHash8(row.id),
    };
  });
  for (let index = 0; index < purchases.length; index += 1) {
    const purchase = purchases[index];
    if (purchase.payoutRail !== "STRIPE_CONNECT") continue;
    const reserved = reservePurchase(purchase);
    const outstanding =
      purchase.pendingTransferMinor > 0 ||
      purchase.pendingFundingMinor > 0 ||
      (!reserved.blockedCode && (reserved.connectMinor > 0 || reserved.refundMinor > 0));
    if (!outstanding) continue;
    const chargeId = (limited[index]?.stripeChargeId || "").trim();
    const facts = chargeId
      ? await retrieveOutstandingChargeSettlement({
          mode,
          chargeId,
          purchaseCurrency: purchase.currency,
        })
      : { ok: false as const, code: "SETTLEMENT_READ_FAILED" };
    purchases[index] = applyOutstandingChargeSettlement(purchase, facts);
  }
  return { purchases, scanComplete };
}

async function listMatchingBankPayouts(
  mode: StripeMode,
  attempt: { id: string; amountMinor: number; currency: string },
): Promise<string[]> {
  const listed = await getStripe(mode).payouts.list({ limit: 100 });
  return listed.data
    .filter((payout) => {
      return (
        payout.livemode === (mode === "LIVE") &&
        payout.automatic !== true &&
        payout.metadata?.sb_bank_remainder === attempt.id &&
        payout.amount === attempt.amountMinor &&
        payout.currency.toLowerCase() === attempt.currency.toLowerCase()
      );
    })
    .map((payout) => payout.id);
}

async function reconcileOpenBankAttempts(mode: StripeMode, currency: string): Promise<void> {
  const attempts = await prisma.platformBankPayoutAttempt.findMany({
    where: { stripeMode: mode, currency, status: { in: [...OPEN_BANK] } },
    orderBy: { sequence: "asc" },
  });
  for (const attempt of attempts) {
    if (!attempt.stripePayoutId) continue;
    try {
      const payout = await getStripe(mode).payouts.retrieve(attempt.stripePayoutId);
      if (payout.livemode !== (mode === "LIVE")) {
        await prisma.platformBankPayoutAttempt.update({
          where: { id: attempt.id },
          data: { status: "UNCERTAIN", failureCode: "BANK_PAYOUT_MODE_MISMATCH" },
        });
        continue;
      }
      if (payout.status === "paid") {
        await prisma.platformBankPayoutAttempt.update({
          where: { id: attempt.id },
          data: { status: "PAID", failureCode: "", postedAt: new Date() },
        });
        continue;
      }
      if (payout.status === "failed" || payout.status === "canceled") {
        await prisma.platformBankPayoutAttempt.update({
          where: { id: attempt.id },
          data: {
            status: "FAILED",
            failureCode: payout.failure_code || "BANK_PAYOUT_FAILED",
            failureMessage: (payout.failure_message || "").slice(0, 200),
          },
        });
      }
    } catch {
      await prisma.platformBankPayoutAttempt.update({
        where: { id: attempt.id },
        data: { status: "UNCERTAIN", failureCode: "BANK_PAYOUT_UNCERTAIN" },
      });
    }
  }
}

async function createSafeBankRemainder(opts: {
  mode: StripeMode;
  currency: string;
  now: Date;
  scanComplete: boolean;
  hadPriorSuccess: boolean;
  liabilities?: { purchases: PurchaseLiability[]; scanComplete: boolean };
}): Promise<{ amountMinor: number; code: string; cutoverAllowed: boolean; rollbackToDailyAllowed: boolean }> {
  const bankEnabled = isPlatformBankRemainderPayoutEnabled(opts.mode);
  const [schedule, liabilities, destination, attempts] = await Promise.all([
    readScheduleInterval(opts.mode),
    opts.liabilities ? Promise.resolve(opts.liabilities) : loadPlatformLiabilities(opts.mode),
    readPlatformBank(opts.mode, opts.currency)
      .then((row) => row)
      .catch(() => ({
        verified: false as const,
        information: "unavailable" as const,
        failed: true as const,
        dashboardConfirmation: "absent" as const,
      })),
    prisma.platformBankPayoutAttempt.findMany({
      where: { stripeMode: opts.mode, currency: opts.currency },
      orderBy: { sequence: "asc" },
    }),
  ]);
  const open = attempts.filter((attempt) => attempt.status === "PENDING" || attempt.status === "UNCERTAIN");
  const uncertain = open.filter((attempt) => attempt.status === "UNCERTAIN").length;
  let availableMinor: number | null = null;
  let balanceFailed = false;
  if (bankEnabled) {
    try {
      availableMinor = await readCardAvailable(opts.mode, opts.currency);
      if (availableMinor == null) balanceFailed = true;
    } catch {
      balanceFailed = true;
      availableMinor = null;
    }
  }
  const unresolvedFromPurchases = liabilities.purchases.reduce(
    (count, purchase) => count + (purchase.pendingTransferMinor > 0 || purchase.pendingFundingMinor > 0 ? 1 : 0),
    0,
  );
  const plan = planSafeBankRemainder({
    mode: opts.mode,
    currency: opts.currency,
    bankEnabled,
    scheduleInterval: schedule.interval,
    availableMinor,
    destinationReady: destination.verified,
    bankInformation: destination.failed ? undefined : destination.information,
    dashboardConfirmation: destination.dashboardConfirmation,
    uncertainBankAttempt: uncertain > 0,
    unresolvedMovements: unresolvedFromPurchases,
    providerReadOk: !schedule.failed && !balanceFailed && !destination.failed,
    inflightBankMinor: open.reduce((sum, attempt) => sum + attempt.amountMinor, 0),
    purchases: liabilities.purchases,
    scanComplete: opts.scanComplete && liabilities.scanComplete,
  });
  const reserved = { gp: 0, connect: 0, refund: 0, inflight: 0 };
  let reserveUnreadable = false;
  for (const purchase of liabilities.purchases) {
    if (purchase.stripeMode !== opts.mode) continue;
    if (purchase.currency.trim().toUpperCase() !== opts.currency.trim().toUpperCase()) {
      if (purchase.pendingTransferMinor > 0 || purchase.pendingFundingMinor > 0) {
        reserveUnreadable = true;
        continue;
      }
      const cross = classifyCrossCurrencyReserve(purchase, opts.currency);
      if (cross.code) reserveUnreadable = true;
      else reserved.connect += cross.minor;
      continue;
    }
    const row = reservePurchase(purchase);
    if (row.blockedCode) reserveUnreadable = true;
    reserved.gp += row.gpMinor;
    reserved.connect += row.connectMinor;
    reserved.refund += row.refundMinor;
    reserved.inflight += row.inflightTransferMinor + row.inflightFundingMinor;
  }
  const rollback = reserveUnreadable
    ? { allowed: false as const, code: "ROLLBACK_BLOCKED_PROTECTED_FUNDS" }
    : dailyScheduleRollbackDecision({
        gpReservedMinor: reserved.gp,
        connectReservedMinor: reserved.connect,
        refundReservedMinor: reserved.refund,
        inflightMinor: reserved.inflight + open.reduce((sum, attempt) => sum + attempt.amountMinor, 0),
        uncertainAttempts: uncertain,
      });
  const cutover = manualScheduleCutoverDecision({
    bankRemainderEnabled: bankEnabled,
    coordinationPresent: true,
    healthStalled: false,
    uncertainBankAttempts: uncertain,
    currencies: [{ currency: opts.currency, destinationReady: destination.verified }],
  });
  const cutoverAllowed = cutover.allowed && opts.hadPriorSuccess;
  const bankKnown = destination.verified || destination.dashboardConfirmation === "recorded";
  if (plan.amountMinor === 0 || !bankKnown) {
    return { amountMinor: 0, code: plan.code, cutoverAllowed, rollbackToDailyAllowed: rollback.allowed };
  }
  if (!opts.hadPriorSuccess) {
    return { amountMinor: 0, code: "CUTOVER_WARMUP", cutoverAllowed: false, rollbackToDailyAllowed: rollback.allowed };
  }
  const sequence = nextBankRemainderAttempt({
    mode: opts.mode,
    currency: opts.currency,
    attempts: attempts.map((attempt) => ({ sequence: attempt.sequence, status: attempt.status })),
  });
  if (sequence.action === "blocked") {
    return { amountMinor: 0, code: sequence.code, cutoverAllowed: false, rollbackToDailyAllowed: rollback.allowed };
  }
  let attempt = attempts.find((row) => row.sequence === sequence.sequence) ?? null;
  if (attempt && attempt.amountMinor !== plan.amountMinor) {
    await prisma.platformBankPayoutAttempt.update({
      where: { id: attempt.id },
      data: { status: "UNCERTAIN", failureCode: "BANK_PAYOUT_AMOUNT_CHANGED" },
    });
    return { amountMinor: 0, code: "BANK_PAYOUT_UNCERTAIN", cutoverAllowed: false, rollbackToDailyAllowed: false };
  }
  if (!attempt && sequence.action === "create") {
    try {
      attempt = await prisma.platformBankPayoutAttempt.create({
        data: {
          stripeMode: opts.mode,
          currency: opts.currency,
          sequence: sequence.sequence,
          amountMinor: plan.amountMinor,
          idempotencyKey: sequence.idempotencyKey,
          destinationId: "",
          status: "PENDING",
        },
      });
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
      if (code !== "P2002") throw err;
      attempt = await prisma.platformBankPayoutAttempt.findUnique({
        where: { idempotencyKey: sequence.idempotencyKey },
      });
      if (!attempt) {
        return { amountMinor: 0, code: "BANK_PAYOUT_UNCERTAIN", cutoverAllowed: false, rollbackToDailyAllowed: false };
      }
    }
  }
  if (!attempt) {
    return { amountMinor: 0, code: "BANK_PAYOUT_UNCERTAIN", cutoverAllowed: false, rollbackToDailyAllowed: false };
  }
  let matching: string[] = [];
  try {
    matching = await listMatchingBankPayouts(opts.mode, attempt);
  } catch {
    await prisma.platformBankPayoutAttempt.update({
      where: { id: attempt.id },
      data: { status: "UNCERTAIN", failureCode: "BANK_PAYOUT_UNCERTAIN" },
    });
    return { amountMinor: 0, code: "BANK_PAYOUT_UNCERTAIN", cutoverAllowed: false, rollbackToDailyAllowed: false };
  }
  const decision = decideFundingRequest({
    legExistedBeforeThisAttempt: sequence.action === "reuse",
    ageMs: opts.now.getTime() - attempt.createdAt.getTime(),
    matchingPayoutIds: matching,
  });
  if (decision.action === "attach") {
    await prisma.platformBankPayoutAttempt.update({
      where: { id: attempt.id },
      data: { stripePayoutId: decision.payoutId, failureCode: "" },
    });
    return { amountMinor: 0, code: "BANK_PAYOUT_ATTACHED", cutoverAllowed, rollbackToDailyAllowed: rollback.allowed };
  }
  if (decision.action !== "create_same_key") {
    await prisma.platformBankPayoutAttempt.update({
      where: { id: attempt.id },
      data: { status: "UNCERTAIN", failureCode: "BANK_PAYOUT_UNCERTAIN" },
    });
    return { amountMinor: 0, code: "BANK_PAYOUT_UNCERTAIN", cutoverAllowed: false, rollbackToDailyAllowed: false };
  }
  try {
    const payout = await fencedProviderWrite(() =>
      getStripe(opts.mode).payouts.create(
        {
          amount: attempt.amountMinor,
          currency: attempt.currency.toLowerCase(),
          source_type: "card",
          metadata: { sb_bank_remainder: attempt.id },
        },
        { idempotencyKey: attempt.idempotencyKey },
      ),
    );
    const returned = payout.destination;
    const observedDestination =
      typeof returned === "string"
        ? returned
        : returned && typeof returned === "object" && "id" in returned && typeof returned.id === "string"
          ? returned.id
          : "";
    await prisma.platformBankPayoutAttempt.update({
      where: { id: attempt.id },
      data: { stripePayoutId: payout.id, destinationId: observedDestination, failureCode: "" },
    });
    return {
      amountMinor: attempt.amountMinor,
      code: "BANK_REMAINDER_PAY",
      cutoverAllowed,
      rollbackToDailyAllowed: rollback.allowed,
    };
  } catch {
    await prisma.platformBankPayoutAttempt.update({
      where: { id: attempt.id },
      data: { status: "UNCERTAIN", failureCode: "BANK_PAYOUT_UNCERTAIN" },
    });
    return { amountMinor: 0, code: "BANK_PAYOUT_UNCERTAIN", cutoverAllowed: false, rollbackToDailyAllowed: false };
  }
}

async function discoverCurrencies(
  mode: StripeMode,
  settlementCurrencies: readonly string[],
): Promise<{
  currencies: string[];
  scanComplete: boolean;
}> {
  const attempts = await prisma.platformBankPayoutAttempt.findMany({
    where: { stripeMode: mode, status: { in: [...OPEN_BANK] } },
    select: { currency: true },
    distinct: ["currency"],
  });
  const openAttemptCurrencies = attempts.map((row) => row.currency);
  try {
    const balance = await getStripe(mode).balance.retrieve();
    if (balance.livemode !== (mode === "LIVE")) {
      return {
        currencies: bankCurrencies({ balanceCurrencies: [], settlementCurrencies, openAttemptCurrencies }),
        scanComplete: false,
      };
    }
    return {
      currencies: bankCurrencies({
        balanceCurrencies: listedBalanceCurrencies([...balance.available, ...balance.pending]),
        settlementCurrencies,
        openAttemptCurrencies,
      }),
      scanComplete: true,
    };
  } catch {
    return {
      currencies: bankCurrencies({ balanceCurrencies: [], settlementCurrencies, openAttemptCurrencies }),
      scanComplete: false,
    };
  }
}

export async function coordinatePlatformBalance(opts: { stripeMode: StripeMode; now?: Date }): Promise<{
  ok: boolean;
  skipped: "disabled" | null;
  mode: StripeMode;
  fundingOn: boolean;
  bankOn: boolean;
  currencies: Array<{
    currency: string;
    code: string;
    amountMinor: number;
    cutoverAllowed: boolean;
    rollbackToDailyAllowed: boolean;
    health: string;
  }>;
}> {
  const mode = normalizeStripeMode(opts.stripeMode);
  const now = opts.now ?? new Date();
  const fundingOn = isGlobalPayoutsProceedsFundingEnabled() && canInitiateGlobalPayoutsMoney(mode);
  const bankOn = isPlatformBankRemainderPayoutEnabled(mode);
  const open = await prisma.platformBankPayoutAttempt.count({
    where: { stripeMode: mode, status: { in: [...OPEN_BANK] } },
  });
  if (!fundingOn && !bankOn && open === 0) {
    return { ok: true, skipped: "disabled", mode, fundingOn, bankOn, currencies: [] };
  }
  const liabilities = await loadPlatformLiabilities(mode);
  const discovered = await discoverCurrencies(mode, settlementLiabilityCurrencies(liabilities.purchases, mode));
  const currencies = discovered.currencies;
  const results = [];
  for (const currency of currencies) {
    const coordination = await prisma.platformBalanceCoordination.findUnique({
      where: { stripeMode_currency: { stripeMode: mode, currency } },
    });
    const health = platformBalanceHealth({
      nowMs: now.getTime(),
      enabled: bankOn || fundingOn,
      lockedAtMs: coordination?.lockedAt ? coordination.lockedAt.getTime() : null,
      lastSuccessAtMs: coordination?.lastSuccessAt ? coordination.lastSuccessAt.getTime() : null,
    });
    const locked = await withPlatformBalanceLock(mode, currency, now, async (report) => {
      await reconcileOpenBankAttempts(mode, currency);
      if (fundingOn) {
        await reconcileGpProceedsFunding({ stripeMode: mode, currency, now, lockHeld: true });
      }
      const bank = bankOn
        ? await createSafeBankRemainder({
            mode,
            currency,
            now,
            scanComplete: discovered.scanComplete,
            hadPriorSuccess: report.hadPriorSuccess,
            liabilities,
          })
        : { amountMinor: 0, code: "BANK_REMAINDER_DISABLED", cutoverAllowed: false, rollbackToDailyAllowed: false };
      report.code = bank.code;
      return bank;
    });
    if (!locked.acquired) {
      results.push({
        currency,
        code: locked.code,
        amountMinor: 0,
        cutoverAllowed: false,
        rollbackToDailyAllowed: false,
        health: health.code || locked.code,
      });
      continue;
    }
    results.push({
      currency,
      code: locked.value.code,
      amountMinor: locked.value.amountMinor,
      cutoverAllowed: locked.value.cutoverAllowed,
      rollbackToDailyAllowed: locked.value.rollbackToDailyAllowed,
      health: health.code,
    });
  }
  return { ok: true, skipped: null, mode, fundingOn, bankOn, currencies: results };
}

/** Webhook recovery. Re-reads the saved attempt and does not create a payout. */
export async function reconcileBankPayoutNotification(opts: {
  mode: StripeMode;
  attemptId: string;
}): Promise<{ ignored: true } | { reconciled: true }> {
  const attempt = await prisma.platformBankPayoutAttempt.findUnique({ where: { id: opts.attemptId } });
  if (!attempt || normalizeStripeMode(attempt.stripeMode) !== normalizeStripeMode(opts.mode)) {
    return { ignored: true };
  }
  const locked = await withPlatformBalanceLock(attempt.stripeMode, attempt.currency, new Date(), async (report) => {
    await reconcileOpenBankAttempts(normalizeStripeMode(attempt.stripeMode), attempt.currency);
    report.code = "BANK_PAYOUT_RECONCILED";
    return true;
  });
  return locked.acquired ? { reconciled: true } : { ignored: true };
}

export async function platformBalanceMonitor(mode: StripeMode, now = new Date()) {
  const rows = await prisma.platformBalanceCoordination.findMany({ where: { stripeMode: mode } });
  const enabled =
    isPlatformBankRemainderPayoutEnabled(mode) ||
    (isGlobalPayoutsProceedsFundingEnabled() && canInitiateGlobalPayoutsMoney(mode));
  return rows.map((row) => ({
    currency: row.currency,
    ...platformBalanceHealth({
      nowMs: now.getTime(),
      enabled,
      lockedAtMs: row.lockedAt ? row.lockedAt.getTime() : null,
      lastSuccessAtMs: row.lastSuccessAt ? row.lastSuccessAt.getTime() : null,
    }),
    lastErrorCode: row.lastErrorCode,
  }));
}
