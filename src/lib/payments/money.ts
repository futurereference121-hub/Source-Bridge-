/** Integer minor-unit money helpers. Never trust client totals. */

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

/** Convert major units (float display) to minor — only for bootstrap from listing.price. */
export function majorToMinor(major: number, currency: string): number {
  const c = currency.toUpperCase();
  const zeroDecimal = new Set(["JPY", "KRW", "VND"]);
  if (zeroDecimal.has(c)) {
    return Math.round(major);
  }
  return Math.round(major * 100);
}

export function minorToMajor(minor: number, currency: string): number {
  const c = currency.toUpperCase();
  const zeroDecimal = new Set(["JPY", "KRW", "VND"]);
  if (zeroDecimal.has(c)) return minor;
  return minor / 100;
}

export function formatMinor(minor: number, currency: string): string {
  const major = minorToMajor(minor, currency);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency.toUpperCase()}`;
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
