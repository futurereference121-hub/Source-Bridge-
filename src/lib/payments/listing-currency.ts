/**
 * Listing presentment currency for create/publish/checkout.
 * Connect keeps the existing allowlist (USD default). Global Payouts
 * Protected listings are GBP only and use the established GP floor.
 * Existing rows are never rewritten here.
 */

import {
  GP_GBP_FLAT_FEE_EXPLANATION,
  GP_GBP_MINIMUM_ENTITLEMENT_MINOR,
  formatGbpMinor,
} from "@/lib/payments/gp-pricing";
import { majorToMinor, normalizeCurrency } from "@/lib/payments/money";
import {
  TICKET_CURRENCY_OPTIONS,
  UNSUPPORTED_PROTECTED_CURRENCY_MESSAGE,
  isAllowedPaymentCurrency,
} from "@/lib/payments/supported-currencies";

export type ListingCurrencyOption = { code: string; label: string };

export function listingCurrencyChoices(opts: {
  gpProtected: boolean;
  allowedCurrencies: string[];
}): ListingCurrencyOption[] {
  if (opts.gpProtected) {
    return TICKET_CURRENCY_OPTIONS.filter((row) => row.code === "GBP");
  }
  const allowed = new Set(
    opts.allowedCurrencies.map((code) => String(code || "").toUpperCase()),
  );
  const fromTicket = TICKET_CURRENCY_OPTIONS.filter((row) =>
    allowed.has(row.code),
  );
  if (fromTicket.length) return fromTicket;
  return [{ code: "USD", label: "USD ($)" }];
}

export function defaultListingCurrency(gpProtected: boolean): string {
  return gpProtected ? "GBP" : "USD";
}

export function gpListingMinimumMinor(): number {
  return GP_GBP_MINIMUM_ENTITLEMENT_MINOR;
}

export function gpListingMinimumCopy(): string {
  return `Minimum seller amount ${formatGbpMinor(GP_GBP_MINIMUM_ENTITLEMENT_MINOR)}. ${GP_GBP_FLAT_FEE_EXPLANATION}`;
}

export function listingGpCurrencyOk(currency: string | null | undefined): boolean {
  return normalizeCurrency(currency || "USD") === "GBP";
}

export function listingGpPriceMeetsMinimum(opts: {
  priceMajor: number;
  currency?: string | null;
}): boolean {
  if (!listingGpCurrencyOk(opts.currency)) return false;
  const minor = majorToMinor(opts.priceMajor, "GBP");
  return minor >= GP_GBP_MINIMUM_ENTITLEMENT_MINOR;
}

export function assertListingCurrencyForPublish(opts: {
  currency: string;
  priceMajor: number;
  gpProtected: boolean;
  allowedCurrencies: string[];
}): string {
  const currency = normalizeCurrency(opts.currency || defaultListingCurrency(opts.gpProtected));
  if (opts.gpProtected) {
    if (currency !== "GBP") {
      throw Object.assign(
        new Error("Global Payouts listings must be priced in GBP."),
        { status: 400, code: "GP_LISTING_CURRENCY" },
      );
    }
    const itemMinor = majorToMinor(opts.priceMajor, currency);
    if (itemMinor < GP_GBP_MINIMUM_ENTITLEMENT_MINOR) {
      throw Object.assign(
        new Error(
          `Minimum seller amount for this listing is ${formatGbpMinor(GP_GBP_MINIMUM_ENTITLEMENT_MINOR)}.`,
        ),
        { status: 400, code: "GP_MINIMUM_ENTITLEMENT" },
      );
    }
    return currency;
  }
  if (!isAllowedPaymentCurrency(currency, opts.allowedCurrencies)) {
    throw Object.assign(new Error(UNSUPPORTED_PROTECTED_CURRENCY_MESSAGE), {
      status: 400,
      code: "CURRENCY_NOT_ALLOWED",
    });
  }
  return currency;
}
