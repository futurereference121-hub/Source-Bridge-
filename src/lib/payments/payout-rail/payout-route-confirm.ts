/**
 * Server-built payout-route confirmation display metadata.
 * Browser may render these fields; it must not invent rail/reason/currency/network.
 */

import type { PayoutRail, PayoutRailResolution } from "@/lib/payments/payout-rail/rail-resolver";
import { getPayoutCountryName } from "@/lib/payments/payout-rail/payout-country";
import { recipientBankCapabilityForCountry } from "@/lib/payments/payout-rail/recipient";

export type PayoutRouteConfirmation = {
  countryCode: string;
  countryName: string;
  rail: PayoutRail;
  reason: string;
  /** Explicit product label required on the confirmation screen only. */
  railLabel: string;
  explanation: string;
  currency: string | null;
  payoutMethod: string | null;
  continueLabel: "Continue to Stripe" | "Continue setup";
  canProceed: boolean;
};

const CONNECT_CURRENCY_BY_COUNTRY: Record<string, string> = {
  US: "USD",
  GB: "GBP",
  AU: "AUD",
  CA: "CAD",
  NZ: "NZD",
  SG: "SGD",
  HK: "HKD",
  JP: "JPY",
  EU: "EUR",
  DE: "EUR",
  FR: "EUR",
  NL: "EUR",
  IE: "EUR",
  ES: "EUR",
  IT: "EUR",
  AT: "EUR",
  BE: "EUR",
  PT: "EUR",
  FI: "EUR",
  SE: "SEK",
  NO: "NOK",
  DK: "DKK",
  CH: "CHF",
  MX: "MXN",
  BR: "BRL",
  IN: "INR",
};

const GP_CURRENCY_BY_COUNTRY: Record<string, string> = {
  TH: "THB",
};

function railLabelFor(rail: PayoutRail): string {
  if (rail === "STRIPE_GLOBAL_PAYOUTS") return "Stripe Global Payouts";
  if (rail === "STRIPE_CONNECT") return "Stripe Connect";
  return "Unavailable";
}

function explanationFor(resolution: PayoutRailResolution): string {
  const countryName =
    getPayoutCountryName(resolution.country) ||
    String(resolution.country || "")
      .trim()
      .toUpperCase() ||
    "your country";

  switch (resolution.reason) {
    case "gp_onboarding_required":
    case "gp_ready":
      return `Source Bridge currently uses Stripe Global Payouts for recipients in ${countryName}.`;
    case "connect_in_progress":
      return "You already started Stripe Connect setup. Continue with the same payout route.";
    case "connect_ready":
      return "Your Stripe Connect payout account is already linked for this country.";
    case "connect_default":
      return `Source Bridge currently uses Stripe Connect for recipients in ${countryName}.`;
    case "global_payouts_disabled":
      return `Source Bridge currently uses Stripe Connect for recipients in ${countryName}.`;
    case "connect_unsupported_country_not_allowlisted":
      return "Payouts are not yet available for this country.";
    case "user_not_allowlisted":
      return "Payouts are not yet available for this account in your country.";
    default:
      if (resolution.rail === "STRIPE_GLOBAL_PAYOUTS") {
        return `Source Bridge currently uses Stripe Global Payouts for recipients in ${countryName}.`;
      }
      if (resolution.rail === "STRIPE_CONNECT") {
        return `Source Bridge currently uses Stripe Connect for recipients in ${countryName}.`;
      }
      return "Payouts are not yet available in your location.";
  }
}

function currencyFor(resolution: PayoutRailResolution): string | null {
  const code = String(resolution.country || "")
    .trim()
    .toUpperCase();
  if (!code) return null;
  if (resolution.rail === "STRIPE_GLOBAL_PAYOUTS") {
    return GP_CURRENCY_BY_COUNTRY[code] || null;
  }
  if (resolution.rail === "STRIPE_CONNECT") {
    return CONNECT_CURRENCY_BY_COUNTRY[code] || null;
  }
  return null;
}

function payoutMethodFor(resolution: PayoutRailResolution): string | null {
  const code = String(resolution.country || "")
    .trim()
    .toUpperCase();
  if (!code) return null;
  if (resolution.rail === "STRIPE_GLOBAL_PAYOUTS") {
    const method = recipientBankCapabilityForCountry(code);
    return method === "wire" ? "Wire" : "Local bank transfer";
  }
  if (resolution.rail === "STRIPE_CONNECT") {
    return "Stripe payouts";
  }
  return null;
}

/**
 * Build confirmation payload from an authoritative resolvePayoutRail result.
 * Incomplete onboarding uses "Continue setup"; fresh start uses "Continue to Stripe".
 */
export function buildPayoutRouteConfirmation(
  resolution: PayoutRailResolution,
  opts?: { incompleteOnboarding?: boolean },
): PayoutRouteConfirmation {
  const countryCode = String(resolution.country || "")
    .trim()
    .toUpperCase();
  const canProceed =
    resolution.rail === "STRIPE_CONNECT" ||
    resolution.rail === "STRIPE_GLOBAL_PAYOUTS";
  const incomplete = Boolean(opts?.incompleteOnboarding);
  return {
    countryCode,
    countryName: getPayoutCountryName(countryCode) || countryCode,
    rail: resolution.rail,
    reason: resolution.reason,
    railLabel: railLabelFor(resolution.rail),
    explanation: explanationFor(resolution),
    currency: currencyFor(resolution),
    payoutMethod: payoutMethodFor(resolution),
    continueLabel: incomplete ? "Continue setup" : "Continue to Stripe",
    canProceed,
  };
}
