/**
 * Read-only cutover check for one Stripe mode.
 * Lists accounts, balances, and liabilities. Does not create quotes or payouts.
 * A TEST heartbeat is stored only on TEST rows and cannot mark LIVE ready.
 */

import { prisma } from "@/lib/db";
import { idHash8, webhookEventCoverage } from "@/lib/payments/payout-rail/proceeds-preflight-shape";
import { canInitiateGlobalPayoutsMoney } from "@/lib/payments/payout-rail/eligibility";
import {
  isGlobalPayoutsProceedsFundingEnabled,
  isPlatformBankRemainderPayoutEnabled,
  normalizeStripeMode,
  type StripeMode,
} from "@/lib/payments/flags";
import {
  evaluateModeReadiness,
  selectVerifiedPlatformBank,
  type ExternalBankAccount,
} from "@/lib/payments/payout-rail/platform-balance";
import { getStripe } from "@/lib/payments/stripe/client";
import { PLATFORM_WEBHOOK_EVENTS } from "@/lib/payments/stripe/webhooks";

export async function runReadOnlyPlatformReadiness(stripeMode: StripeMode) {
  const mode = normalizeStripeMode(stripeMode);
  const moneyMovementEnabled =
    isPlatformBankRemainderPayoutEnabled(mode) ||
    (isGlobalPayoutsProceedsFundingEnabled() && canInitiateGlobalPayoutsMoney(mode));
  const currencies = await currenciesForRead(mode);
  const results = [];
  for (const currency of currencies) {
    const existing = await prisma.platformBalanceCoordination.findUnique({
      where: { stripeMode_currency: { stripeMode: mode, currency } },
      select: { readinessCheckedAt: true },
    });
    const observed = await observeCurrency(mode, currency);
    const decision = evaluateModeReadiness({
      mode,
      scheduleInterval: observed.scheduleInterval,
      destinationReady: observed.destinationReady,
      providerReadsOk: observed.providerReadsOk,
      liabilitiesReadable: observed.liabilitiesReadable,
      unresolvedMovements: observed.unresolvedMovements,
      priorReadinessPass: Boolean(existing?.readinessCheckedAt),
      moneyMovementEnabled,
    });
    if (decision.code === "CUTOVER_WARMUP" || decision.ready) {
      await prisma.platformBalanceCoordination.upsert({
        where: { stripeMode_currency: { stripeMode: mode, currency } },
        create: {
          stripeMode: mode,
          currency,
          readinessCheckedAt: new Date(),
          readinessCode: decision.code,
        },
        update: { readinessCheckedAt: new Date(), readinessCode: decision.code },
      });
    }
    results.push({
      currency,
      ready: decision.ready,
      payoutsAllowed: decision.payoutsAllowed,
      code: decision.code,
      scheduleInterval: observed.scheduleInterval,
      destinationReady: observed.destinationReady,
      liabilitiesReadable: observed.liabilitiesReadable,
      fundedPurchaseCount: observed.fundedPurchaseCount,
      scanComplete: observed.scanComplete,
      recordedNets: observed.recordedNets,
    });
  }
  const ready = results.length > 0 && results.every((row) => row.ready);
  const webhooks = await readWebhookCoverage(mode);
  return {
    mode,
    ready,
    payoutsAllowed: false as const,
    moneyMovementEnabled,
    quotesCreated: 0 as const,
    payoutsCreated: 0 as const,
    webhooks,
    currencies: results,
  };
}

async function readWebhookCoverage(mode: StripeMode): Promise<{ covered: string[]; missing: string[] } | null> {
  try {
    const stripe = getStripe(mode);
    const enabled: string[] = [];
    let startingAfter = "";
    for (let page = 0; page < 3; page += 1) {
      const list = await stripe.webhookEndpoints.list({
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      for (const endpoint of list.data) {
        if (endpoint.livemode !== (mode === "LIVE")) continue;
        for (const event of endpoint.enabled_events) enabled.push(event);
      }
      if (!list.has_more || list.data.length === 0) break;
      startingAfter = list.data[list.data.length - 1]?.id || "";
      if (!startingAfter) break;
    }
    return webhookEventCoverage(enabled, PLATFORM_WEBHOOK_EVENTS);
  } catch {
    return null;
  }
}

async function currenciesForRead(mode: StripeMode): Promise<string[]> {
  const rows = await prisma.protectedTransaction.findMany({
    where: { stripeMode: mode, fundedAt: { not: null } },
    select: { currency: true },
    distinct: ["currency"],
    take: 20,
  });
  const currencies = new Set(rows.map((row) => row.currency.toUpperCase()));
  if (currencies.size === 0) currencies.add("GBP");
  return [...currencies];
}

async function observeCurrency(mode: StripeMode, currency: string) {
  let scheduleInterval: string | null = null;
  let providerReadsOk = true;
  let destinationReady = false;
  try {
    const stripe = getStripe(mode);
    const account = await stripe.accounts.retrieve();
    const interval = account.settings?.payouts?.schedule?.interval;
    scheduleInterval = typeof interval === "string" ? interval : null;
    if (!scheduleInterval || !account.id) providerReadsOk = false;
    if (account.id) {
      const listed = await stripe.accounts.listExternalAccounts(account.id, {
        object: "bank_account",
        limit: 100,
      });
      const banks: ExternalBankAccount[] = listed.data.map((row) => {
        const bank = row as {
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
      destinationReady = selectVerifiedPlatformBank(banks, {
        currency,
        livemode: mode === "LIVE",
        hasMore: listed.has_more,
      }).ok;
    }
    const balance = await stripe.balance.retrieve();
    if (balance.livemode !== (mode === "LIVE")) providerReadsOk = false;
  } catch {
    providerReadsOk = false;
  }
  const purchases = await prisma.protectedTransaction.findMany({
    where: {
      stripeMode: mode,
      currency: { equals: currency, mode: "insensitive" },
      fundedAt: { not: null },
    },
    take: 501,
    include: {
      gpProceedsFunding: { select: { chargeNetMinor: true, balanceTransactionId: true, legs: { select: { status: true } } } },
      transferAttempts: { where: { status: "PENDING" }, select: { id: true } },
    },
  });
  let liabilitiesReadable = purchases.length <= 500;
  const recordedNets: Array<{ purchaseHash: string; chargeNetMinor: number; recorded: boolean }> = [];
  if (liabilitiesReadable && providerReadsOk) {
    for (const purchase of purchases) {
      const recorded = await recordObservedGpNet(mode, purchase);
      if (purchase.payoutRail === "STRIPE_GLOBAL_PAYOUTS") {
        recordedNets.push({
          purchaseHash: idHash8(purchase.id),
          chargeNetMinor: recorded.netMinor,
          recorded: recorded.recorded,
        });
      }
      if (!recorded.readable) liabilitiesReadable = false;
    }
  }
  const unresolvedMovements = purchases.reduce((count, purchase) => {
    const pendingFunding = purchase.gpProceedsFunding?.legs.some((leg) => leg.status === "PENDING") ? 1 : 0;
    return count + purchase.transferAttempts.length + pendingFunding;
  }, 0);
  return {
    scheduleInterval,
    providerReadsOk,
    destinationReady,
    liabilitiesReadable,
    unresolvedMovements,
    fundedPurchaseCount: purchases.length,
    scanComplete: purchases.length <= 500,
    recordedNets,
  };
}

/**
 * Read a Global Payouts charge net and store that snapshot.
 * Does not create a quote, funding leg, or payout.
 */
async function recordObservedGpNet(
  mode: StripeMode,
  purchase: {
    id: string;
    payoutRail: string;
    status: string;
    currency: string;
    stripeChargeId: string | null;
    itemCostMinor: number;
    shippingMinor: number;
    sellerServiceFeeMinor: number;
    gpProceedsFunding: { chargeNetMinor: number | null; balanceTransactionId: string | null } | null;
  },
): Promise<{ readable: boolean; recorded: boolean; netMinor: number }> {
  if (purchase.payoutRail !== "STRIPE_GLOBAL_PAYOUTS") return { readable: true, recorded: false, netMinor: 0 };
  if (["RELEASED", "REFUNDED", "CANCELLED", "FAILED"].includes(purchase.status)) {
    return { readable: true, recorded: false, netMinor: purchase.gpProceedsFunding?.chargeNetMinor ?? 0 };
  }
  const stored = purchase.gpProceedsFunding;
  if (stored?.balanceTransactionId && (stored.chargeNetMinor ?? 0) > 0) {
    return { readable: true, recorded: true, netMinor: stored.chargeNetMinor ?? 0 };
  }
  const chargeId = (purchase.stripeChargeId || "").trim();
  if (!chargeId) return { readable: false, recorded: false, netMinor: 0 };
  try {
    const charge = await getStripe(mode).charges.retrieve(chargeId, { expand: ["balance_transaction"] });
    const balanceTransaction = charge.balance_transaction;
    if (!balanceTransaction || typeof balanceTransaction !== "object" || typeof balanceTransaction.net !== "number") {
      return { readable: false, recorded: false, netMinor: 0 };
    }
    if (!("id" in balanceTransaction) || typeof balanceTransaction.id !== "string" || !balanceTransaction.id) {
      return { readable: false, recorded: false, netMinor: 0 };
    }
    const availableOn =
      "available_on" in balanceTransaction && typeof balanceTransaction.available_on === "number"
        ? new Date(balanceTransaction.available_on * 1000)
        : null;
    await prisma.gpProceedsFunding.upsert({
      where: { protectedTxnId: purchase.id },
      create: {
        protectedTxnId: purchase.id,
        stripeMode: mode,
        currency: purchase.currency.toUpperCase(),
        chargeId,
        balanceTransactionId: balanceTransaction.id,
        principalMinor: purchase.itemCostMinor + purchase.shippingMinor + purchase.sellerServiceFeeMinor,
        chargeNetMinor: balanceTransaction.net,
        availableOn,
        status: "AWAITING_SETTLEMENT",
      },
      update: {
        chargeId,
        balanceTransactionId: balanceTransaction.id,
        chargeNetMinor: balanceTransaction.net,
        availableOn,
      },
    });
    return { readable: true, recorded: true, netMinor: balanceTransaction.net };
  } catch {
    return { readable: false, recorded: false, netMinor: 0 };
  }
}

