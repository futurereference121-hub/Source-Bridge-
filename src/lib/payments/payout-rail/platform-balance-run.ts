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
  reservePurchase,
  selectVerifiedPlatformBank,
  type ExternalBankAccount,
  type PurchaseLiability,
} from "@/lib/payments/payout-rail/platform-balance";
import { decideFundingRequest } from "@/lib/payments/payout-rail/proceeds-funding";
import { reconcileGpProceedsFunding } from "@/lib/payments/payout-rail/proceeds-funding-run";
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
  const row = balance.available.find((entry) => entry.currency === currency.toLowerCase());
  const card = row && "source_types" in row ? row.source_types?.card : undefined;
  return typeof card === "number" ? card : null;
}

async function readPlatformBank(
  mode: StripeMode,
  currency: string,
): Promise<{ ok: true; destinationId: string } | { ok: false; code: string }> {
  const stripe = getStripe(mode);
  const account = await stripe.accounts.retrieve();
  if (!account.id) return { ok: false, code: "BANK_DESTINATION_UNVERIFIED" };
  const listed = await stripe.accounts.listExternalAccounts(account.id, {
    object: "bank_account",
    limit: 100,
  });
  const accounts: ExternalBankAccount[] = listed.data.map((accountRow) => {
    const bank = accountRow as {
      id?: string;
      object?: string;
      currency?: string;
      default_for_currency?: boolean;
      status?: string;
      livemode?: boolean;
    };
    return {
      id: bank.id || "",
      object: bank.object || "",
      currency: bank.currency || "",
      defaultForCurrency: bank.default_for_currency === true,
      status: bank.status || "",
      livemode: bank.livemode === true,
    };
  });
  return selectVerifiedPlatformBank(accounts, {
    currency,
    livemode: mode === "LIVE",
    hasMore: listed.has_more,
  });
}

async function loadLiabilities(mode: StripeMode, currency: string): Promise<{
  purchases: PurchaseLiability[];
  scanComplete: boolean;
}> {
  const rows = await prisma.protectedTransaction.findMany({
    where: {
      stripeMode: mode,
      currency: { equals: currency, mode: "insensitive" },
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
  const purchases: PurchaseLiability[] = rows.slice(0, PLATFORM_BALANCE_RESERVE_SCAN_CAP).map((row) => {
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
      durablyCreditedMinor: credited,
      outboundStatuses: row.outboundPaymentAttempts.map((attempt) => attempt.status),
      pendingTransferMinor: row.transferAttempts.reduce((sum, attempt) => sum + attempt.amountMinor, 0),
      pendingFundingMinor: pendingFunding,
    };
  });
  return { purchases, scanComplete };
}

async function listMatchingBankPayouts(
  mode: StripeMode,
  attempt: { id: string; amountMinor: number; currency: string },
  destinationId: string,
): Promise<string[]> {
  const listed = await getStripe(mode).payouts.list({ limit: 100 });
  return listed.data
    .filter((payout) => {
      const destination = typeof payout.destination === "string" ? payout.destination : payout.destination?.id;
      return (
        payout.automatic !== true &&
        payout.metadata?.sb_bank_remainder === attempt.id &&
        payout.amount === attempt.amountMinor &&
        payout.currency.toLowerCase() === attempt.currency.toLowerCase() &&
        destination === destinationId
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
}): Promise<{ amountMinor: number; code: string; cutoverAllowed: boolean; rollbackToDailyAllowed: boolean }> {
  const bankEnabled = isPlatformBankRemainderPayoutEnabled(opts.mode);
  const [schedule, liabilities, destination, attempts] = await Promise.all([
    readScheduleInterval(opts.mode),
    loadLiabilities(opts.mode, opts.currency),
    readPlatformBank(opts.mode, opts.currency)
      .then((row) => ({ ...row, failed: false as const }))
      .catch(() => ({ ok: false as const, code: "BANK_DESTINATION_UNVERIFIED", failed: true as const })),
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
    destinationReady: destination.ok,
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
    currencies: destination.ok ? [{ currency: opts.currency, destinationReady: true }] : [],
  });
  const cutoverAllowed = cutover.allowed && opts.hadPriorSuccess;
  if (plan.amountMinor === 0 || !destination.ok) {
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
  if (attempt && (attempt.amountMinor !== plan.amountMinor || (attempt.destinationId && attempt.destinationId !== destination.destinationId))) {
    await prisma.platformBankPayoutAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "UNCERTAIN",
        failureCode: attempt.amountMinor !== plan.amountMinor ? "BANK_PAYOUT_AMOUNT_CHANGED" : "BANK_DESTINATION_CHANGED",
      },
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
          destinationId: destination.destinationId,
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
    matching = await listMatchingBankPayouts(opts.mode, attempt, destination.destinationId);
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
          destination: destination.destinationId,
          source_type: "card",
          metadata: { sb_bank_remainder: attempt.id },
        },
        { idempotencyKey: attempt.idempotencyKey },
      ),
    );
    await prisma.platformBankPayoutAttempt.update({
      where: { id: attempt.id },
      data: { stripePayoutId: payout.id, destinationId: destination.destinationId, failureCode: "" },
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

async function discoverCurrencies(mode: StripeMode, bankOn: boolean): Promise<{
  currencies: string[];
  scanComplete: boolean;
}> {
  const rows = await prisma.protectedTransaction.findMany({
    where: { stripeMode: mode, fundedAt: { not: null } },
    select: { currency: true },
    distinct: ["currency"],
    take: PLATFORM_BALANCE_RESERVE_SCAN_CAP + 1,
  });
  const attempts = await prisma.platformBankPayoutAttempt.findMany({
    where: { stripeMode: mode, status: { in: [...OPEN_BANK] } },
    select: { currency: true },
    distinct: ["currency"],
  });
  const currencies = new Set<string>([
    ...rows.map((row) => row.currency.toUpperCase()),
    ...attempts.map((row) => row.currency.toUpperCase()),
  ]);
  if (bankOn) {
    try {
      const balance = await getStripe(mode).balance.retrieve();
      if (balance.livemode === (mode === "LIVE")) {
        for (const entry of balance.available) {
          if ((entry.source_types?.card ?? 0) > 0) currencies.add(entry.currency.toUpperCase());
        }
      }
    } catch {
      return { currencies: [...currencies], scanComplete: false };
    }
  }
  return {
    currencies: [...currencies],
    scanComplete: rows.length <= PLATFORM_BALANCE_RESERVE_SCAN_CAP,
  };
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
  const discovered = await discoverCurrencies(mode, bankOn);
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
