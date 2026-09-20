/**
 * Isolated Stripe Global Payouts HTTP client (API v2).
 * Uses restricted GP credentials only — never Connect/platform unrestricted keys.
 * No live money objects unless GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED.
 */

import {
  getStripeMode,
  normalizeStripeMode,
  type StripeMode,
} from "@/lib/payments/flags";
import { assertGlobalPayoutsMoneyAllowed } from "@/lib/payments/payout-rail/eligibility";

/**
 * Pinned Stripe API version for Global Payouts (Accounts v2 / account_links).
 * Official Global Payouts docs require an explicit `.preview` Stripe-Version
 * (https://docs.stripe.com/global-payouts/stripe-hosted-recipient-creation).
 * Do not reuse Connect (`dahlia`) or Payments API versions here.
 */
export const STRIPE_GP_API_VERSION = "2026-08-26.preview";

function trimEnv(name: string): string {
  return (process.env[name] || "").trim();
}

export function hasGlobalPayoutsRestrictedKey(mode?: StripeMode): boolean {
  const m = normalizeStripeMode(mode ?? getStripeMode());
  if (m === "LIVE") {
    return Boolean(trimEnv("STRIPE_GP_RESTRICTED_KEY_LIVE"));
  }
  return Boolean(trimEnv("STRIPE_GP_RESTRICTED_KEY_TEST"));
}

export function getGlobalPayoutsFinancialAccountId(mode?: StripeMode): string {
  const m = normalizeStripeMode(mode ?? getStripeMode());
  if (m === "LIVE") return trimEnv("STRIPE_GP_FINANCIAL_ACCOUNT_ID_LIVE");
  return trimEnv("STRIPE_GP_FINANCIAL_ACCOUNT_ID_TEST");
}

function getRestrictedKey(mode: StripeMode): string {
  if (mode === "LIVE") {
    const key = trimEnv("STRIPE_GP_RESTRICTED_KEY_LIVE");
    if (!key) {
      throw Object.assign(
        new Error("Global Payouts Live restricted key is not configured"),
        { status: 503, code: "STRIPE_GP_NOT_CONFIGURED" },
      );
    }
    // Restricted keys are typically rk_live_ / rk_test_; also accept sk_ only if explicitly provided as GP key name.
    return key;
  }
  const key = trimEnv("STRIPE_GP_RESTRICTED_KEY_TEST");
  if (!key) {
    throw Object.assign(
      new Error("Global Payouts TEST restricted key is not configured"),
      { status: 503, code: "STRIPE_GP_NOT_CONFIGURED" },
    );
  }
  return key;
}

export type GpHttpResult = {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
};

/**
 * Low-level GP API call. Never logs Authorization or full sensitive payloads.
 */
export async function gpFetch(opts: {
  mode?: StripeMode;
  method: "GET" | "POST" | "POST_FORM";
  path: string;
  body?: Record<string, unknown>;
  idempotencyKey?: string;
  /**
   * Stripe Accounts v2 / Money Management context (recipient Account id).
   * Required to list payout methods owned by a recipient — query `account=`
   * is not the documented scoping mechanism for GP PayoutMethods.
   * @see https://docs.stripe.com/global-payouts/api-recipient-creation
   */
  stripeContext?: string;
  /** When true, refuses LIVE unless live initiation enabled. */
  moneyMutation?: boolean;
}): Promise<GpHttpResult> {
  const mode = normalizeStripeMode(opts.mode ?? getStripeMode());
  if (opts.moneyMutation) {
    assertGlobalPayoutsMoneyAllowed(mode);
  }

  const key = getRestrictedKey(mode);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Stripe-Version": STRIPE_GP_API_VERSION,
    Accept: "application/json",
  };
  if (opts.idempotencyKey) {
    headers["Idempotency-Key"] = opts.idempotencyKey;
  }
  const ctx = String(opts.stripeContext || "").trim();
  if (ctx) {
    headers["Stripe-Context"] = ctx;
  }

  let body: string | undefined;
  if (opts.method === "POST" && opts.body) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  } else if (opts.method === "POST_FORM" && opts.body) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.body)) {
      if (v == null) continue;
      if (typeof v === "object") {
        params.set(k, JSON.stringify(v));
      } else {
        params.set(k, String(v));
      }
    }
    body = params.toString();
  }

  const url = `https://api.stripe.com${opts.path.startsWith("/") ? opts.path : `/${opts.path}`}`;
  const res = await fetch(url, {
    method: opts.method === "GET" ? "GET" : "POST",
    headers,
    body: opts.method === "GET" ? undefined : body,
  });

  let parsed: Record<string, unknown> = {};
  try {
    parsed = (await res.json()) as Record<string, unknown>;
  } catch {
    parsed = {};
  }

  return { ok: res.ok, status: res.status, body: parsed };
}

export function gpErrorMessage(result: GpHttpResult): string {
  const err = result.body?.error;
  if (err && typeof err === "object") {
    const msg = (err as { message?: string }).message;
    if (msg) return String(msg).slice(0, 500);
  }
  return `Global Payouts API error (${result.status})`;
}
