/**
 * Redacted facts for the normal-checkout preflight.
 * Pure: no database, no Stripe, no secrets.
 */

import { createHash } from "node:crypto";

export function preflightHash8(value: string): string {
  return createHash("sha256").update(String(value || "")).digest("hex").slice(0, 8);
}

export const CHECKOUT_PREFLIGHT_MARKER = "GP_NORMAL_CHECKOUT_SANDBOX_v1";
export const EXPECTED_PREVIEW_HOST_H8 = "bf232aa9";
export const SOURCER_USERNAME = "testingtesting";

export type EmailPlaceholderKind =
  | "empty"
  | "reserved_invalid_domain"
  | "reserved_example"
  | null;

/** Classify a mailbox without returning the address. */
export function emailPlaceholderKind(email: string): EmailPlaceholderKind {
  const value = String(email || "").trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return "empty";
  const domain = value.slice(at + 1);
  if (domain === "example.invalid" || domain.endsWith(".invalid")) {
    return "reserved_invalid_domain";
  }
  if (domain === "example.com" || domain === "example.org" || domain === "example.net") {
    return "reserved_example";
  }
  return null;
}

export type AccountLoginFacts = {
  user_h8: string;
  email_verified: boolean;
  has_password: boolean;
  password_login_supported: boolean;
  onboarding_complete: boolean;
  must_change_password: boolean;
  is_demo: boolean;
  is_test_account: boolean;
  deleted: boolean;
  email_placeholder: EmailPlaceholderKind;
};

export function accountLoginFacts(row: {
  id: string;
  email: string;
  emailVerified: boolean;
  passwordHash: string | null;
  onboardingComplete: boolean;
  mustChangePassword: boolean;
  isDemo: boolean;
  isTestAccount: boolean;
  deletedAt: Date | null;
}): AccountLoginFacts {
  const hasPassword = Boolean(row.passwordHash);
  return {
    user_h8: preflightHash8(row.id),
    email_verified: row.emailVerified === true,
    has_password: hasPassword,
    password_login_supported: hasPassword,
    onboarding_complete: row.onboardingComplete === true,
    must_change_password: row.mustChangePassword === true,
    is_demo: row.isDemo === true,
    is_test_account: row.isTestAccount === true,
    deleted: row.deletedAt != null,
    email_placeholder: emailPlaceholderKind(row.email),
  };
}

export function isUsableCheckoutBuyer(
  facts: AccountLoginFacts,
  sourcerUserH8: string | null,
): boolean {
  return (
    !facts.deleted &&
    !facts.is_demo &&
    facts.email_verified &&
    facts.has_password &&
    facts.user_h8 !== sourcerUserH8
  );
}

function integerMinor(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

/** Documented v2 shape: balance.available is a map of ISO currency to {value, currency}. */
export function readFaAvailableBalances(body: Record<string, unknown> | null): Array<{
  currency: string;
  available_minor: number;
}> {
  const balance =
    body?.balance && typeof body.balance === "object"
      ? (body.balance as Record<string, unknown>)
      : null;
  const available =
    balance?.available && typeof balance.available === "object"
      ? (balance.available as Record<string, unknown>)
      : null;
  if (!available) return [];
  const rows: Array<{ currency: string; available_minor: number }> = [];
  for (const [key, raw] of Object.entries(available)) {
    if (!/^[a-z]{3}$/.test(key) || !raw || typeof raw !== "object") continue;
    const amount = raw as { value?: unknown; currency?: unknown };
    const minor = integerMinor(amount.value);
    const currency = typeof amount.currency === "string" ? amount.currency.toLowerCase() : key;
    if (minor == null || currency !== key) continue;
    rows.push({ currency, available_minor: minor });
  }
  return rows;
}
