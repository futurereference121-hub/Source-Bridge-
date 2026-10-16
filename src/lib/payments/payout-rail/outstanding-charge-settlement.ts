/**
 * Read-only platform charge retrieve for an outstanding Connect reserve.
 * No connected-account header is sent, so a successful read is this platform
 * account's charge. Nothing is written to Stripe or to the payment record.
 */

import { classifyStripeReadFailure } from "@/lib/payments/payout-rail/platform-balance";
import {
  shapeOutstandingChargeSettlement,
  type OutstandingChargeSettlement,
} from "@/lib/payments/payout-rail/connect-settlement-amount";
import { getStripe } from "@/lib/payments/stripe/client";
import type { StripeMode } from "@/lib/payments/flags";

function objectLivemode(value: object): boolean | undefined {
  const livemode = (value as { livemode?: unknown }).livemode;
  return livemode === true ? true : livemode === false ? false : undefined;
}

export async function retrieveOutstandingChargeSettlement(input: {
  mode: StripeMode;
  chargeId: string;
  purchaseCurrency: string;
}): Promise<OutstandingChargeSettlement> {
  const chargeId = input.chargeId.trim();
  try {
    const charge = await getStripe(input.mode).charges.retrieve(chargeId, {
      expand: ["balance_transaction"],
    });
    const balanceTransaction = charge.balance_transaction;
    return shapeOutstandingChargeSettlement({
      mode: input.mode,
      purchaseCurrency: input.purchaseCurrency,
      requestedChargeId: chargeId,
      platformOwned: true,
      charge: {
        id: charge.id,
        livemode: charge.livemode,
        currency: charge.currency,
        amount: charge.amount,
        balanceTransaction:
          balanceTransaction && typeof balanceTransaction === "object"
            ? {
                livemode: objectLivemode(balanceTransaction),
                currency: balanceTransaction.currency,
                amount: balanceTransaction.amount,
                net: balanceTransaction.net,
              }
            : balanceTransaction,
      },
    });
  } catch (err) {
    const failure = classifyStripeReadFailure(err);
    return shapeOutstandingChargeSettlement({
      mode: input.mode,
      purchaseCurrency: input.purchaseCurrency,
      requestedChargeId: chargeId,
      platformOwned: true,
      charge: null,
      failure: { stripeCode: failure.stripeCode },
    });
  }
}
