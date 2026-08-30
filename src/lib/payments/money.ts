/** Integer minor-unit money helpers. Never trust client totals. */

import {
  STRIPE_THREE_DECIMAL_CURRENCIES,
  STRIPE_ZERO_DECIMAL_CURRENCIES,
} from "@/lib/payments/supported-currencies";

export type MoneyBreakdownInput = {
  itemCostMinor: number;
  shippingMinor: number;
  sellerServiceFeeMinor: number;
  protectionFeeMinor: number;
};

export function assertNonNegativeInt(n: number, label: string): number {
  if (!Number.isInteger(n) || n < 0) {
    throw Object.assign(new Error(`${label} must be a non-negative integer`), {
      status: 400,
      code: "INVALID_AMOUNT",
    });
  }
  return n;
}

/**
 * Apply basis points to a minor-unit amount, rounding to the nearest minor unit.
 * Half-up for non-negative values (same direction as Math.round on exact halves).
 * Integer-only arithmetic — never use floating-point for money.
 *
 * feeMinor = roundBpsToMinor(feeBaseMinor, 700)  // 7%
 */
export function roundBpsToMinor(amountMinor: number, bps: number): number {
  const amount = Math.max(0, amountMinor);
  const rate = Math.max(0, bps);
  const product = amount * rate;
  const quotient = Math.trunc(product / 10_000);
  const remainder = product % 10_000;
  return remainder >= 5_000 ? quotient + 1 : quotient;
}

export function sumMinor(parts: number[]): number {
  return parts.reduce((acc, n) => {
    assertNonNegativeInt(n, "amount");
    return acc + n;
  }, 0);
}

export function totalChargeMinor(b: MoneyBreakdownInput): number {
  return sumMinor([
    b.itemCostMinor,
    b.shippingMinor,
    b.sellerServiceFeeMinor,
    b.protectionFeeMinor,
  ]);
}

export function currencyExponent(currency: string): number {
  const c = currency.toUpperCase();
  if (STRIPE_ZERO_DECIMAL_CURRENCIES.has(c)) return 0;
  if (STRIPE_THREE_DECIMAL_CURRENCIES.has(c)) return 3;
  return 2;
}

/** Convert major units (float display) to minor — only for bootstrap from listing.price. */
export function majorToMinor(major: number, currency: string): number {
  const exp = currencyExponent(currency);
  if (exp === 0) return Math.round(major);
  const factor = 10 ** exp;
  return Math.round(major * factor);
}

export function minorToMajor(minor: number, currency: string): number {
  const exp = currencyExponent(currency);
  if (exp === 0) return minor;
  return minor / 10 ** exp;
}

/**
 * Parse a human currency amount ("100.00", "50") into integer minor units.
 * Rejects raw minor-unit integers disguised as pounds (no more than 2 decimals
 * for standard currencies; zero-decimal currencies accept whole numbers only).
 */
export function parseHumanAmountToMinor(
  raw: string,
  currency: string,
): number | null {
  const trimmed = String(raw ?? "")
    .trim()
    .replace(/,/g, "")
    .replace(/^[£$€¥]\s?/, "");
  if (!trimmed) return null;
  const exp = currencyExponent(currency);
  const decimalRe =
    exp === 0
      ? /^\d+$/
      : exp === 3
        ? /^\d+(\.\d{1,3})?$/
        : /^\d+(\.\d{1,2})?$/;
  if (!decimalRe.test(trimmed)) return null;
  const major = Number(trimmed);
  if (!Number.isFinite(major) || major < 0) return null;
  return majorToMinor(major, currency);
}

export function formatMinor(minor: number, currency: string): string {
  const major = minorToMajor(minor, currency);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: currencyExponent(currency),
      minimumFractionDigits: currencyExponent(currency) === 0 ? 0 : undefined,
    }).format(major);
  } catch {
    const exp = currencyExponent(currency);
    return `${exp === 0 ? String(major) : major.toFixed(exp)} ${currency.toUpperCase()}`;
  }
}

export function normalizeCurrency(raw: string): string {
  const c = (raw || "USD").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) {
    throw Object.assign(new Error("Invalid currency"), {
      status: 400,
      code: "INVALID_CURRENCY",
    });
  }
  return c;
}
