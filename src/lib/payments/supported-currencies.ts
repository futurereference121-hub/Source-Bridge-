/**
 * Authoritative protected-payment currency support.
 *
 * Presentment currencies Stripe accepts for PaymentIntents / charges.
 * Source: https://docs.stripe.com/currencies#presentment-currencies
 *
 * Connect note (SCT): charge presentment currency is stored on the
 * ProtectedTransaction and never silently rewritten. Seller releases may
 * use Stripe settlement currency when the platform balance settles a
 * non-local presentment charge (see release.ts) — that is Stripe settlement,
 * not app FX of ledger amounts.
 */

/** User-facing message when a currency is outside the supported set. */
export const UNSUPPORTED_PROTECTED_CURRENCY_MESSAGE =
  "This currency isn't currently supported for protected payments.";

/**
 * Stripe presentment (charge) currencies — ISO 4217 uppercase.
 * Do not invent codes outside this set.
 */
export const STRIPE_PRESENTMENT_CURRENCIES: readonly string[] = [
  "AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN",
  "BAM", "BBD", "BDT", "BGN", "BIF", "BMD", "BND", "BOB", "BRL", "BSD",
  "BWP", "BYN", "BZD", "CAD", "CDF", "CHF", "CLP", "CNY", "COP", "CRC",
  "CVE", "CZK", "DJF", "DKK", "DOP", "DZD", "EGP", "ETB", "EUR", "FJD",
  "FKP", "GBP", "GEL", "GIP", "GMD", "GNF", "GTQ", "GYD", "HKD", "HNL",
  "HTG", "HUF", "IDR", "ILS", "INR", "ISK", "JMD", "JPY", "KES", "KGS",
  "KHR", "KMF", "KRW", "KYD", "KZT", "LAK", "LBP", "LKR", "LRD", "LSL",
  "MAD", "MDL", "MGA", "MKD", "MMK", "MNT", "MOP", "MUR", "MVR", "MWK",
  "MXN", "MYR", "MZN", "NAD", "NGN", "NIO", "NOK", "NPR", "NZD", "PAB",
  "PEN", "PGK", "PHP", "PKR", "PLN", "PYG", "QAR", "RON", "RSD", "RUB",
  "RWF", "SAR", "SBD", "SCR", "SEK", "SGD", "SHP", "SLE", "SOS", "SRD",
  "STD", "SZL", "THB", "TJS", "TOP", "TRY", "TTD", "TWD", "TZS", "UAH",
  "UGX", "USD", "UYU", "UZS", "VND", "VUV", "WST", "XAF", "XCD", "XCG",
  "XOF", "XPF", "YER", "ZAR", "ZMW",
] as const;

const STRIPE_SET = new Set(
  STRIPE_PRESENTMENT_CURRENCIES.map((c) => c.toUpperCase()),
);

/**
 * Stripe zero-decimal currencies (amount is the major unit).
 * https://docs.stripe.com/currencies#zero-decimal
 */
export const STRIPE_ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF", "CLP", "DJF", "GNF", "HUF", "ISK", "JPY", "KMF", "KRW", "MGA",
  "PYG", "RWF", "TWD", "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);

/**
 * Stripe three-decimal currencies (minor = major × 1000).
 * https://docs.stripe.com/currencies#three-decimal
 */
export const STRIPE_THREE_DECIMAL_CURRENCIES = new Set([
  "BHD", "JOD", "KWD", "OMR", "TND",
]);

/** Common currencies offered in ticket/listing UI (all Stripe-supported). */
export const TICKET_CURRENCY_OPTIONS: readonly {
  code: string;
  label: string;
}[] = [
  { code: "EUR", label: "EUR (€)" },
  { code: "GBP", label: "GBP (£)" },
  { code: "USD", label: "USD ($)" },
  { code: "AUD", label: "AUD (A$)" },
  { code: "CAD", label: "CAD (C$)" },
  { code: "CHF", label: "CHF" },
  { code: "INR", label: "INR (₹)" },
  { code: "JPY", label: "JPY (¥)" },
  { code: "MXN", label: "MXN" },
  { code: "THB", label: "THB (฿)" },
  { code: "SGD", label: "SGD" },
  { code: "NZD", label: "NZD" },
  { code: "SEK", label: "SEK" },
  { code: "NOK", label: "NOK" },
  { code: "DKK", label: "DKK" },
  { code: "PLN", label: "PLN" },
  { code: "RUB", label: "RUB" },
  { code: "BRL", label: "BRL" },
  { code: "HKD", label: "HKD" },
  { code: "KRW", label: "KRW" },
];

/** Legacy PlatformPaymentConfig defaults that must not block EUR/etc. */
const LEGACY_DB_DEFAULTS = new Set(["USD", "GBP,USD", "USD,GBP"]);

function normalizeCode(raw: string): string | null {
  const c = String(raw || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) return null;
  return c;
}

function parseCurrencyList(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((x) => (typeof x === "string" ? normalizeCode(x) : null))
      .filter((x): x is string => Boolean(x));
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) return parseCurrencyList(parsed);
    } catch {
      /* CSV / space-separated */
    }
    return trimmed
      .split(/[\s,]+/)
      .map((x) => normalizeCode(x))
      .filter((x): x is string => Boolean(x));
  }
  return [];
}

function isLegacyDbAllowlist(codes: string[]): boolean {
  if (codes.length === 0) return true;
  const key = [...codes].map((c) => c.toUpperCase()).sort().join(",");
  return LEGACY_DB_DEFAULTS.has(key);
}

function intersectStripe(codes: string[]): string[] {
  return Array.from(
    new Set(
      codes.map((c) => c.toUpperCase()).filter((c) => STRIPE_SET.has(c)),
    ),
  ).sort();
}

/**
 * Resolve the single allowlist used by tickets, product checkout, and asserts.
 *
 * Precedence:
 * 1. PAYMENTS_ALLOWED_CURRENCIES env (CSV or JSON) ∩ Stripe
 * 2. Non-legacy DB allowlist ∩ Stripe
 * 3. Full Stripe presentment set (international default — includes EUR)
 */
export function resolveAllowedPaymentCurrencies(opts?: {
  dbJson?: string | null;
  envRaw?: string | null;
}): string[] {
  const envRaw =
    opts?.envRaw !== undefined
      ? opts.envRaw
      : process.env.PAYMENTS_ALLOWED_CURRENCIES || null;
  const fromEnv = parseCurrencyList(envRaw);
  if (fromEnv.length) {
    const hit = intersectStripe(fromEnv);
    if (hit.length) return hit;
  }

  const fromDb = parseCurrencyList(opts?.dbJson ?? null);
  if (fromDb.length && !isLegacyDbAllowlist(fromDb)) {
    const hit = intersectStripe(fromDb);
    if (hit.length) return hit;
  }

  return [...STRIPE_PRESENTMENT_CURRENCIES];
}

export function isStripePresentmentCurrency(currency: string): boolean {
  const c = normalizeCode(currency);
  return Boolean(c && STRIPE_SET.has(c));
}

export function isAllowedPaymentCurrency(
  currency: string,
  allowed: string[],
): boolean {
  const c = normalizeCode(currency);
  if (!c || !STRIPE_SET.has(c)) return false;
  return allowed.map((x) => x.toUpperCase()).includes(c);
}
