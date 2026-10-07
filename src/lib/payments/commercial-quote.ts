/**
 * Server price for a new or revised agreement, after the payout rail is known.
 * Clients cannot choose the rail, fee, total, policy, or Stripe mode.
 * Stored agreements keep their recorded fee. This module is for propose,
 * revise, and new product checkout only.
 */

import { getPlatformPaymentConfig, assertCurrencyAllowed } from "@/lib/payments/config";
import {
  calculateFees,
  resolveAgreedSellerLines,
  type FeeConfig,
} from "@/lib/payments/fees";
import { getStripeMode } from "@/lib/payments/flags";
import {
  GP_GBP_FEE_EXPLANATION,
  GP_GBP_PROGRESSIVE_V1,
  formatGbpMinor,
  globalPayoutsGbpFeeMinor,
  gpGbpEntitlementFloorMinor,
} from "@/lib/payments/gp-pricing";
import { normalizeCurrency } from "@/lib/payments/money";
import { isDirectPaymentOption } from "@/lib/payments/payment-option";
import { assertSandboxCommercialTerms } from "@/lib/payments/payout-rail/sandbox-pair";

export type QuotedCommercialTerms = {
  itemCostMinor: number;
  shippingMinor: number;
  sellerServiceFeeMinor: number;
  protectionFeeMinor: number;
  currency: string;
  totalChargeMinor: number;
  platformFeeIncludedInPrice: boolean;
  pricingPolicy: string;
  feeExplanation: string;
  payoutRail: "STRIPE_CONNECT" | "STRIPE_GLOBAL_PAYOUTS";
  stripeMode: "TEST" | "LIVE";
  config: Awaited<ReturnType<typeof getPlatformPaymentConfig>>;
};

function reject(message: string, status: number, code: string): never {
  throw Object.assign(new Error(message), { status, code });
}

/**
 * Price after the server has already chosen the rail.
 * Empty stored policy keeps the Connect calculation, including on an old
 * Global Payouts ticket. A missing policy (null) on a new Global Payouts
 * agreement uses the GBP progressive schedule.
 */
export function priceAfterResolvedRail(opts: {
  itemCostMinor: number;
  shippingMinor: number;
  sellerServiceFeeMinor: number;
  currency: string;
  paymentOption: string;
  payoutRail: "STRIPE_CONNECT" | "STRIPE_GLOBAL_PAYOUTS";
  existingPricingPolicy: string | null;
  platformFeeIncludedInPrice?: boolean;
  destinationMinimumsRaw?: string;
  config: FeeConfig;
}): Omit<QuotedCommercialTerms, "config"> {
  const currency = normalizeCurrency(opts.currency);
  const entitlement =
    opts.itemCostMinor + opts.shippingMinor + opts.sellerServiceFeeMinor;
  const included = Boolean(opts.platformFeeIncludedInPrice);
  const existing = opts.existingPricingPolicy;
  if (existing && existing !== GP_GBP_PROGRESSIVE_V1) {
    reject(
      "This agreement uses a pricing policy that cannot be revised.",
      409,
      "GP_PRICING_POLICY_UNKNOWN",
    );
  }

  const storedGp = existing === GP_GBP_PROGRESSIVE_V1;
  const isNew = existing == null;
  const useGpSchedule =
    storedGp || (isNew && opts.payoutRail === "STRIPE_GLOBAL_PAYOUTS");

  let protectionFeeMinor: number;
  let pricingPolicy = "";
  let feeExplanation = "";

  if (useGpSchedule) {
    if (opts.payoutRail !== "STRIPE_GLOBAL_PAYOUTS") {
      reject(
        "This agreement is priced for Global Payouts.",
        409,
        "GP_PRICING_RAIL_MISMATCH",
      );
    }
    if (isDirectPaymentOption(opts.paymentOption)) {
      reject(
        "This test payment must use Protected Payment.",
        409,
        "GP_SANDBOX_PROTECTED_ONLY",
      );
    }
    if (currency !== "GBP") {
      reject(
        "This Global Payouts price applies to GBP agreements only.",
        409,
        "GP_PRICING_CURRENCY_UNSUPPORTED",
      );
    }
    if (included) {
      reject(
        "The Source Bridge fee is added on top. The sourcer receives the full agreed amount.",
        400,
        "GP_FEE_ADDED_ON_TOP",
      );
    }
    const floorMinor = gpGbpEntitlementFloorMinor(opts.destinationMinimumsRaw || "");
    if (entitlement < floorMinor) {
      reject(
        `Minimum seller amount for this payment is ${formatGbpMinor(floorMinor)}.`,
        400,
        "GP_MINIMUM_ENTITLEMENT",
      );
    }
    protectionFeeMinor = globalPayoutsGbpFeeMinor(entitlement);
    pricingPolicy = GP_GBP_PROGRESSIVE_V1;
    feeExplanation = GP_GBP_FEE_EXPLANATION;
  } else {
    const fees = calculateFees({
      itemCostMinor: opts.itemCostMinor,
      shippingMinor: opts.shippingMinor,
      config: opts.config,
      paymentOption: opts.paymentOption,
      sellerServiceFeeMinorOverride: opts.sellerServiceFeeMinor,
    });
    protectionFeeMinor = fees.protectionFeeMinor;
  }

  const totalChargeMinor = included
    ? entitlement
    : entitlement + protectionFeeMinor;

  return {
    itemCostMinor: opts.itemCostMinor,
    shippingMinor: opts.shippingMinor,
    sellerServiceFeeMinor: opts.sellerServiceFeeMinor,
    protectionFeeMinor,
    currency,
    totalChargeMinor,
    platformFeeIncludedInPrice: included,
    pricingPolicy,
    feeExplanation,
    payoutRail: opts.payoutRail,
    stripeMode: "TEST",
  };
}

export async function quoteCommercialTerms(opts: {
  itemCostMinor: number;
  shippingMinor?: number;
  sellerServiceFeeMinor?: number;
  currency?: string;
  paymentOption?: string;
  buyerId: string;
  sellerId: string;
  platformFeeIncludedInPrice?: boolean;
  /** null for a brand-new agreement. "" keeps the legacy 7% method. */
  existingPricingPolicy: string | null;
}): Promise<QuotedCommercialTerms> {
  const config = await getPlatformPaymentConfig();
  const currency = normalizeCurrency(opts.currency || "USD");
  assertCurrencyAllowed(currency, config);
  const paymentOption = opts.paymentOption || "PROTECTED";
  const lines = resolveAgreedSellerLines({
    itemCostMinor: opts.itemCostMinor,
    shippingMinor: opts.shippingMinor ?? 0,
    config,
    sellerServiceFeeMinorOverride: opts.sellerServiceFeeMinor,
  });
  const entitlement =
    lines.itemCostMinor + lines.shippingMinor + lines.sellerServiceFeeMinor;
  const sandboxDecision = assertSandboxCommercialTerms({
    buyerId: opts.buyerId,
    sellerId: opts.sellerId,
    currency,
    principalMinor: entitlement,
    paymentOption,
  });
  const payoutRail =
    sandboxDecision.state === "pair" ? "STRIPE_GLOBAL_PAYOUTS" : "STRIPE_CONNECT";
  const stripeMode = sandboxDecision.state === "pair" ? "TEST" : getStripeMode();
  const priced = priceAfterResolvedRail({
    ...lines,
    currency,
    paymentOption,
    payoutRail,
    existingPricingPolicy: opts.existingPricingPolicy,
    platformFeeIncludedInPrice: opts.platformFeeIncludedInPrice,
    destinationMinimumsRaw: process.env.GLOBAL_PAYOUTS_LIVE_DESTINATION_MINIMUMS || "",
    config,
  });
  return { ...priced, payoutRail, stripeMode, config };
}
