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

export function readCashAvailable(body: Record<string, unknown> | null): {
  available_minor: number | null;
  currency: string | null;
} {
  const balance =
    body?.balance && typeof body.balance === "object"
      ? (body.balance as Record<string, unknown>)
      : body;
  const cash =
    balance && typeof balance === "object"
      ? ((balance as { cash?: { available?: { value?: unknown; currency?: unknown } } }).cash
          ?.available ??
        (balance as { available?: { value?: unknown; currency?: unknown } }).available)
      : null;
  const value = cash && typeof cash.value === "number" && Number.isInteger(cash.value) ? cash.value : null;
  const currency =
    cash && typeof cash.currency === "string" && /^[a-z]{3}$/i.test(cash.currency)
      ? cash.currency.toLowerCase()
      : null;
  return { available_minor: value, currency };
}
