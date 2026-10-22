/**
 * Dedicated flags-off coordination warmup.
 * Takes the real lock, reads Stripe, and calculates liabilities.
 * It never creates quotes, funding payouts, seller outbound, bank payouts,
 * transfers, or refunds. Warmup evidence is lastWarmupAt, not lastSuccessAt.
 */

import { prisma } from "@/lib/db";
import { canInitiateGlobalPayoutsMoney } from "@/lib/payments/payout-rail/eligibility";
import {
  isGlobalPayoutsProceedsFundingEnabled,
  isPlatformBankRemainderPayoutEnabled,
  normalizeStripeMode,
  type StripeMode,
} from "@/lib/payments/flags";
import { withPlatformBalanceLock } from "@/lib/payments/payout-rail/platform-balance-lock";
import {
  assessPlatformBank,
  bankCurrencies,
  listedBalanceCurrencies,
  planSafeBankRemainder,
  readPlatformExternalAccounts,
  reservePurchase,
  settlementLiabilityCurrencies,
} from "@/lib/payments/payout-rail/platform-balance";
import { loadPlatformLiabilities } from "@/lib/payments/payout-rail/platform-balance-run";
import { getStripe } from "@/lib/payments/stripe/client";

function moneyWorkerEnabled(mode: StripeMode): boolean {
  return (
    isPlatformBankRemainderPayoutEnabled(mode) ||
    (isGlobalPayoutsProceedsFundingEnabled() && canInitiateGlobalPayoutsMoney(mode))
  );
}

async function warmupCurrencies(mode: StripeMode, settlementCurrencies: readonly string[]): Promise<string[]> {
  const existing = await prisma.platformBalanceCoordination.findMany({
    where: { stripeMode: mode },
    select: { currency: true },
  });
  let balanceCurrencies: string[] = [];
  try {
    const balance = await getStripe(mode).balance.retrieve();
    if (balance.livemode === (mode === "LIVE")) {
      balanceCurrencies = listedBalanceCurrencies([...balance.available, ...balance.pending]);
    }
  } catch {
    balanceCurrencies = [];
  }
  const currencies = bankCurrencies({
    balanceCurrencies,
    settlementCurrencies,
    openAttemptCurrencies: existing.map((row) => row.currency),
  });
  return currencies.length > 0 ? currencies : ["GBP"];
}

export async function runPlatformBalanceWarmup(stripeMode: StripeMode): Promise<{
  ok: true;
  skipped: "money_worker_enabled" | null;
  mode: StripeMode;
  payoutsAllowed: false;
  currencies: Array<{
    currency: string;
    acquired: boolean;
    code: string;
    scheduleInterval: string | null;
    reservedMinor: number;
  }>;
}> {
  const mode = normalizeStripeMode(stripeMode);
  if (moneyWorkerEnabled(mode)) {
    return { ok: true, skipped: "money_worker_enabled", mode, payoutsAllowed: false, currencies: [] };
  }
  const now = new Date();
  const liabilities = await loadPlatformLiabilities(mode);
  const currencies = await warmupCurrencies(mode, settlementLiabilityCurrencies(liabilities.purchases, mode));
  const results: Array<{
    currency: string;
    acquired: boolean;
    code: string;
    scheduleInterval: string | null;
    reservedMinor: number;
  }> = [];
  for (const currency of currencies) {
    const locked = await withPlatformBalanceLock(
      mode,
      currency,
      now,
      async (report) => {
      report.recordAs = "warmup";
      const stripe = getStripe(mode);
      let scheduleInterval: string | null = null;
      let providerReadOk = true;
      try {
        const account = await stripe.accounts.retrieve();
        const interval = account.settings?.payouts?.schedule?.interval;
        scheduleInterval = typeof interval === "string" ? interval : null;
        if (typeof interval !== "string") providerReadOk = false;
        assessPlatformBank(readPlatformExternalAccounts(account), {
          currency,
          livemode: mode === "LIVE",
        });
      } catch {
        providerReadOk = false;
      }
      let availableMinor: number | null = null;
      try {
        const balance = await stripe.balance.retrieve();
        if (balance.livemode !== (mode === "LIVE")) {
          providerReadOk = false;
        } else {
          const row = balance.available.find((entry) => entry.currency === currency.toLowerCase());
          const card = row && "source_types" in row ? row.source_types?.card : undefined;
          availableMinor = typeof card === "number" ? card : null;
        }
      } catch {
        providerReadOk = false;
      }
      for (const purchase of liabilities.purchases) {
        if (purchase.stripeMode === mode) reservePurchase(purchase);
      }
      const plan = planSafeBankRemainder({
        mode,
        currency,
        bankEnabled: false,
        scheduleInterval,
        availableMinor,
        destinationReady: false,
        uncertainBankAttempt: false,
        providerReadOk,
        inflightBankMinor: 0,
        purchases: liabilities.purchases,
        scanComplete: liabilities.scanComplete,
      });
      report.code = "WARMUP_OK";
      return {
        currency,
        code: report.code,
        scheduleInterval,
        reservedMinor: plan.reservedMinor,
      };
    },
      { recordAs: "warmup" },
    );
    if (!locked.acquired) {
      results.push({
        currency,
        acquired: false,
        code: locked.code,
        scheduleInterval: null,
        reservedMinor: 0,
      });
      continue;
    }
    results.push({ ...locked.value, acquired: true });
  }
  return { ok: true, skipped: null, mode, payoutsAllowed: false, currencies: results };
}
