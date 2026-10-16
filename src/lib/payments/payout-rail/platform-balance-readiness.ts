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
  assessPlatformBank,
  bankCurrencies,
  classifyStripeReadFailure,
  evaluateModeReadiness,
  listedBalanceAmounts,
  listedBalanceCurrencies,
  outstandingConnectReserves,
  readPlatformExternalAccounts,
  settlementBlockForCurrency,
  settlementLiabilityCurrencies,
} from "@/lib/payments/payout-rail/platform-balance";
import { getStripe } from "@/lib/payments/stripe/client";
import { PLATFORM_WEBHOOK_EVENTS } from "@/lib/payments/stripe/webhooks";
import { dashboardConfirmationForAccount, retrievedAccountLivemode, stripeAccountIdentity } from "@/lib/payments/payout-rail/platform-bank-confirmation";
import { loadPlatformLiabilities } from "@/lib/payments/payout-rail/platform-balance-run";

export async function runReadOnlyPlatformReadiness(stripeMode: StripeMode) {
  const mode = normalizeStripeMode(stripeMode);
  const moneyMovementEnabled =
    isPlatformBankRemainderPayoutEnabled(mode) ||
    (isGlobalPayoutsProceedsFundingEnabled() && canInitiateGlobalPayoutsMoney(mode));
  const liabilities = await loadPlatformLiabilities(mode);
  const balance = await currenciesForRead(mode, settlementLiabilityCurrencies(liabilities.purchases, mode));
  const currencies = balance.currencies;
  const results = [];
  for (const currency of currencies) {
    const existing = await prisma.platformBalanceCoordination.findUnique({
      where: { stripeMode_currency: { stripeMode: mode, currency } },
      select: { readinessCheckedAt: true },
    });
    const observed = await observeCurrency(mode, currency);
    const decision = evaluateModeReadiness({
      mode,
      currency,
      scheduleInterval: observed.scheduleInterval,
      destinationReady: observed.destinationReady,
      providerReadsOk: observed.providerReadsOk,
      liabilitiesReadable: observed.liabilitiesReadable && liabilities.scanComplete,
      unresolvedMovements: observed.unresolvedMovements,
      bankInformation: observed.bankInformation,
      dashboardConfirmation: observed.dashboardConfirmation,
      settlementCode: liabilities.scanComplete
        ? settlementBlockForCurrency(liabilities.purchases, currency, mode)
        : "GP_RESERVE_UNKNOWN",
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
      destinationCode: observed.destinationCode,
      defaultDestinationRouting: observed.defaultDestinationRouting,
      bankConfigurationVerified: observed.bankConfigurationVerified,
      bankInformation: observed.bankInformation,
      dashboardConfirmation: observed.dashboardConfirmation,
      accountSuffix: observed.accountSuffix,
      accountHash8: observed.accountHash8,
      liabilitiesReadable: observed.liabilitiesReadable,
      fundedPurchaseCount: observed.fundedPurchaseCount,
      scanComplete: observed.scanComplete,
      recordedNets: observed.recordedNets,
      reads: observed.reads,
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
    balance: {
      ok: balance.ok,
      available: balance.available,
      pending: balance.pending,
    },
    outstandingConnect: outstandingConnectReserves(liabilities.purchases, mode),
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

async function currenciesForRead(
  mode: StripeMode,
  settlementCurrencies: readonly string[],
): Promise<{
  currencies: string[];
  ok: boolean;
  available: { currency: string; amountMinor: number | null }[] | null;
  pending: { currency: string; amountMinor: number | null }[] | null;
}> {
  const attempts = await prisma.platformBankPayoutAttempt.findMany({
    where: { stripeMode: mode, status: { in: ["PENDING", "UNCERTAIN"] } },
    select: { currency: true },
    distinct: ["currency"],
  });
  const openAttemptCurrencies = attempts.map((row) => row.currency);
  const currenciesFor = (balanceCurrencies: readonly string[]) =>
    bankCurrencies({ balanceCurrencies, settlementCurrencies, openAttemptCurrencies });
  try {
    const balance = await getStripe(mode).balance.retrieve();
    if (typeof balance.livemode !== "boolean" || balance.livemode !== (mode === "LIVE")) {
      return { currencies: currenciesFor([]), ok: false, available: null, pending: null };
    }
    return {
      currencies: currenciesFor(listedBalanceCurrencies([...balance.available, ...balance.pending])),
      ok: true,
      available: listedBalanceAmounts(balance.available),
      pending: listedBalanceAmounts(balance.pending),
    };
  } catch {
    return { currencies: currenciesFor([]), ok: false, available: null, pending: null };
  }
}

type ProviderRead = {
  operation: string;
  ok: boolean;
  httpStatus: number | null;
  stripeCode: string | null;
  stripeType: string | null;
  requestId: string | null;
  apiVersion: string | null;
};

function apiVersionOf(stripe: object): string | null {
  try {
    const reader = stripe as { getApiField?: (key: string) => unknown };
    const value = reader.getApiField?.("version");
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}\.[A-Za-z0-9]+$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

function providerRead(
  operation: string,
  apiVersion: string | null,
  err?: unknown,
  override?: { ok: boolean; httpStatus?: number | null; stripeCode?: string | null },
): ProviderRead {
  const classified = err === undefined
    ? { httpStatus: 200 as number | null, stripeCode: null, stripeType: null, requestId: null }
    : classifyStripeReadFailure(err);
  const outcome: ProviderRead = {
    operation,
    ok: override?.ok ?? err === undefined,
    httpStatus: override?.httpStatus !== undefined ? override.httpStatus : classified.httpStatus,
    stripeCode: override?.stripeCode !== undefined ? override.stripeCode : classified.stripeCode,
    stripeType: classified.stripeType,
    requestId: classified.requestId,
    apiVersion,
  };
  if (!outcome.ok) console.error("[platform-readiness-read]", JSON.stringify(outcome));
  return outcome;
}

async function observeCurrency(mode: StripeMode, currency: string) {
  const reads: ProviderRead[] = [];
  let scheduleInterval: string | null = null;
  let providerReadsOk = true;
  let destinationReady = false;
  let destinationCode = "BANK_INFORMATION_UNAVAILABLE";
  let bankInformation: "unavailable" | "verified" | "unverified" = "unavailable";
  let defaultDestinationRouting = "supported" as const;
  let bankConfigurationVerified = false;
  let dashboardConfirmation: "recorded" | "absent" = "absent";
  let accountSuffix = "";
  let accountHash8 = "";
  let accountLivemode: boolean | null = null;
  const stripe = getStripe(mode);
  const apiVersion = apiVersionOf(stripe);
  let accountId = "";
  try {
    const account = await stripe.accounts.retrieve();
    accountId = account.id || "";
    accountLivemode = retrievedAccountLivemode(account);
    const interval = account.settings?.payouts?.schedule?.interval;
    scheduleInterval = typeof interval === "string" ? interval : null;
    if (!accountId || !scheduleInterval) {
      providerReadsOk = false;
      reads.push(providerRead("accounts.retrieve", apiVersion, undefined, {
        ok: false,
        httpStatus: 200,
        stripeCode: !accountId ? "account_id_missing" : "schedule_unreadable",
      }));
    } else {
      reads.push(providerRead("accounts.retrieve", apiVersion));
      const assessment = assessPlatformBank(readPlatformExternalAccounts(account), {
        currency,
        livemode: mode === "LIVE",
      });
      destinationReady = assessment.bankConfigurationVerified;
      destinationCode = assessment.code;
      bankInformation = assessment.bankInformation;
      defaultDestinationRouting = assessment.defaultDestinationRouting;
      bankConfigurationVerified = assessment.bankConfigurationVerified;
      reads.push(providerRead("account.external_accounts", apiVersion));
    }
  } catch (err) {
    providerReadsOk = false;
    reads.push(providerRead("accounts.retrieve", apiVersion, err));
  }
  if (accountId && accountLivemode !== null) {
    const identity = stripeAccountIdentity(accountId);
    accountSuffix = identity.suffix;
    accountHash8 = identity.hash8;
    dashboardConfirmation = await dashboardConfirmationForAccount({
      stripeMode: mode,
      currency,
      accountId,
      livemode: accountLivemode,
    });
  }
  try {
    const balance = await stripe.balance.retrieve();
    if (typeof balance.livemode !== "boolean" || balance.livemode !== (mode === "LIVE")) {
      providerReadsOk = false;
      reads.push(providerRead("balance.retrieve", apiVersion, undefined, {
        ok: false,
        httpStatus: 200,
        stripeCode: typeof balance.livemode === "boolean" ? "livemode_mismatch" : "livemode_missing",
      }));
    } else {
      reads.push(providerRead("balance.retrieve", apiVersion));
    }
  } catch (err) {
    providerReadsOk = false;
    reads.push(providerRead("balance.retrieve", apiVersion, err));
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
  const recordedNets: Array<{
    purchaseHash: string;
    chargeNetMinor: number;
    recorded: boolean;
    read: ProviderRead | null;
  }> = [];
  // Charge nets are independent of bank verification. An omitted bank list does not skip them.
  if (liabilitiesReadable && providerReadsOk) {
    for (const purchase of purchases) {
      const recorded = await recordObservedGpNet(mode, purchase);
      if (purchase.payoutRail === "STRIPE_GLOBAL_PAYOUTS") {
        recordedNets.push({
          purchaseHash: idHash8(purchase.id),
          chargeNetMinor: recorded.netMinor,
          recorded: recorded.recorded,
          read: recorded.read,
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
    destinationCode,
    defaultDestinationRouting,
    bankConfigurationVerified,
    bankInformation,
    dashboardConfirmation,
    accountSuffix,
    accountHash8,
    liabilitiesReadable,
    unresolvedMovements,
    fundedPurchaseCount: purchases.length,
    scanComplete: purchases.length <= 500,
    recordedNets,
    reads,
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
): Promise<{ readable: boolean; recorded: boolean; netMinor: number; read: ProviderRead | null }> {
  if (purchase.payoutRail !== "STRIPE_GLOBAL_PAYOUTS") return { readable: true, recorded: false, netMinor: 0, read: null };
  if (["RELEASED", "REFUNDED", "CANCELLED", "FAILED"].includes(purchase.status)) {
    return { readable: true, recorded: false, netMinor: purchase.gpProceedsFunding?.chargeNetMinor ?? 0, read: null };
  }
  const stored = purchase.gpProceedsFunding;
  if (stored?.balanceTransactionId && (stored.chargeNetMinor ?? 0) > 0) {
    return { readable: true, recorded: true, netMinor: stored.chargeNetMinor ?? 0, read: null };
  }
  const stripe = getStripe(mode);
  const apiVersion = apiVersionOf(stripe);
  const chargeId = (purchase.stripeChargeId || "").trim();
  if (!chargeId) {
    return {
      readable: false,
      recorded: false,
      netMinor: 0,
      read: providerRead("charges.retrieve", apiVersion, undefined, {
        ok: false,
        httpStatus: null,
        stripeCode: "charge_id_missing",
      }),
    };
  }
  try {
    const charge = await stripe.charges.retrieve(chargeId, { expand: ["balance_transaction"] });
    const balanceTransaction = charge.balance_transaction;
    if (!balanceTransaction || typeof balanceTransaction !== "object" || typeof balanceTransaction.net !== "number") {
      return {
        readable: false,
        recorded: false,
        netMinor: 0,
        read: providerRead("charges.retrieve", apiVersion, undefined, {
          ok: false,
          httpStatus: 200,
          stripeCode: "charge_net_missing",
        }),
      };
    }
    if (!("id" in balanceTransaction) || typeof balanceTransaction.id !== "string" || !balanceTransaction.id) {
      return {
        readable: false,
        recorded: false,
        netMinor: 0,
        read: providerRead("charges.retrieve", apiVersion, undefined, {
          ok: false,
          httpStatus: 200,
          stripeCode: "balance_transaction_missing",
        }),
      };
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
    return { readable: true, recorded: true, netMinor: balanceTransaction.net, read: providerRead("charges.retrieve", apiVersion) };
  } catch (err) {
    return {
      readable: false,
      recorded: false,
      netMinor: 0,
      read: providerRead("charges.retrieve", apiVersion, err),
    };
  }
}

