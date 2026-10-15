/**
 * Read-only TEST settlement diagnostic.
 * Selects funded USD Connect purchases itself. Stripe and the database stay unchanged.
 */

import { prisma } from "@/lib/db";
import { classifyStripeReadFailure } from "@/lib/payments/payout-rail/platform-balance";
import { idHash8 } from "@/lib/payments/payout-rail/proceeds-preflight-shape";
import {
  shapeChargeSettlement,
  shapePlatformBalance,
  type PlatformBalanceReport,
  type PurchaseSettlement,
} from "@/lib/payments/payout-rail/usd-connect-settlement";
import { getStripe } from "@/lib/payments/stripe/client";

const SCAN_CAP = 20;

function objectLivemode(value: object): boolean | null {
  const livemode = (value as { livemode?: unknown }).livemode;
  return livemode === true ? true : livemode === false ? false : null;
}

export async function readUsdConnectSettlement(): Promise<{
  mode: "TEST";
  matchedCount: number;
  scanComplete: boolean;
  balance: PlatformBalanceReport;
  purchases: PurchaseSettlement[];
}> {
  const rows = await prisma.protectedTransaction.findMany({
    where: {
      stripeMode: "TEST",
      currency: { equals: "USD", mode: "insensitive" },
      fundedAt: { not: null },
      payoutRail: "STRIPE_CONNECT",
    },
    orderBy: { fundedAt: "asc" },
    take: SCAN_CAP + 1,
    select: { id: true, currency: true, stripeChargeId: true },
  });
  const scanComplete = rows.length <= SCAN_CAP;
  const stripe = getStripe("TEST");
  const purchases: PurchaseSettlement[] = [];
  for (const row of rows.slice(0, SCAN_CAP)) {
    const purchaseHash = idHash8(row.id);
    const chargeId = (row.stripeChargeId || "").trim();
    if (!chargeId) {
      purchases.push(shapeChargeSettlement({
        purchaseHash,
        purchaseCurrency: row.currency,
        chargeIdPresent: false,
      }));
      continue;
    }
    try {
      const charge = await stripe.charges.retrieve(chargeId, { expand: ["balance_transaction"] });
      const balanceTransaction = charge.balance_transaction;
      const transactionLivemode =
        balanceTransaction && typeof balanceTransaction === "object"
          ? objectLivemode(balanceTransaction)
          : null;
      purchases.push(shapeChargeSettlement({
        purchaseHash,
        purchaseCurrency: row.currency,
        chargeIdPresent: true,
        charge: {
          livemode: charge.livemode,
          currency: charge.currency,
          balanceTransaction:
            balanceTransaction && typeof balanceTransaction === "object"
              ? {
                  livemode: transactionLivemode === null ? undefined : transactionLivemode,
                  currency: balanceTransaction.currency,
                  amount: balanceTransaction.amount,
                  fee: balanceTransaction.fee,
                  net: balanceTransaction.net,
                  exchange_rate: balanceTransaction.exchange_rate,
                  status: balanceTransaction.status,
                  available_on: balanceTransaction.available_on,
                }
              : balanceTransaction,
        },
      }));
    } catch (err) {
      const failure = classifyStripeReadFailure(err);
      purchases.push(shapeChargeSettlement({
        purchaseHash,
        purchaseCurrency: row.currency,
        chargeIdPresent: true,
        failure: { httpStatus: failure.httpStatus, stripeCode: failure.stripeCode },
      }));
    }
  }

  let balance: PlatformBalanceReport;
  try {
    const retrieved = await stripe.balance.retrieve();
    balance = shapePlatformBalance({
      livemode: retrieved.livemode,
      available: retrieved.available,
      pending: retrieved.pending,
    });
  } catch (err) {
    const failure = classifyStripeReadFailure(err);
    balance = shapePlatformBalance({
      failure: { httpStatus: failure.httpStatus, stripeCode: failure.stripeCode },
    });
  }

  return {
    mode: "TEST",
    matchedCount: Math.min(rows.length, SCAN_CAP),
    scanComplete,
    balance,
    purchases,
  };
}
