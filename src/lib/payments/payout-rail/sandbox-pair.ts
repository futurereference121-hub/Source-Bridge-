/**
 * Production Global Payouts Sandbox pair.
 * Server-controlled and fail-closed. Client fields, usernames, headers, and
 * URL parameters cannot select TEST mode. Missing or ambiguous configuration
 * leaves every checkout on the ordinary Stripe mode.
 */

import {
  getStripeMode,
  isGlobalPayoutsEnabled,
  isGlobalPayoutsSandboxEnabled,
  type StripeMode,
} from "../flags.ts";
import { quotedPayoutCover } from "./live-pilot.ts";

function countryAllowlist(): string[] {
  return String(process.env.GLOBAL_PAYOUTS_COUNTRY_ALLOWLIST || "")
    .split(/[,;\s]+/)
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
}

const CUID = /^c[a-z0-9]{20,32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURRENCY = /^[A-Z]{3}$/;
const POSITIVE_MINOR = /^[1-9]\d*$/;

export type SandboxPairConfig = {
  enabled: true;
  buyerId: string;
  sourcerId: string;
  currency: string;
  maxAmountMinor: number;
};

export type SandboxCheckoutDecision =
  | { state: "inactive" }
  | { state: "ordinary"; stripeMode: StripeMode; payoutRail: "STRIPE_CONNECT" }
  | {
      state: "pair";
      stripeMode: "TEST";
      payoutRail: "STRIPE_GLOBAL_PAYOUTS";
      currency: string;
      maxAmountMinor: number;
    }
  | { state: "refused"; code: "GP_SANDBOX_PAIR_REQUIRED" };

function singleToken(raw: string | undefined): string | null {
  const text = String(raw ?? "");
  if (text !== text.trim()) return null;
  const value = text.trim();
  if (!value) return null;
  if (/[\s,;*]/.test(value)) return null;
  return value;
}

function immutableUserId(raw: string | undefined): string | null {
  const value = singleToken(raw);
  if (!value) return null;
  if (value.includes("@") || value.includes("/") || value.includes("\\")) return null;
  if (CUID.test(value) || UUID.test(value)) return value;
  return null;
}

export function readGpSandboxPair(
  env: NodeJS.ProcessEnv = process.env,
): SandboxPairConfig | null {
  if (!isGlobalPayoutsEnabled()) return null;
  if (!isGlobalPayoutsSandboxEnabled()) return null;
  const liveInitiation = String(env.GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED || "")
    .trim()
    .toLowerCase();
  if (liveInitiation === "1" || liveInitiation === "true" || liveInitiation === "yes" || liveInitiation === "on") {
    return null;
  }

  const buyerId = immutableUserId(env.GP_SANDBOX_APPROVED_BUYER_ID);
  const sourcerId = immutableUserId(env.GP_SANDBOX_APPROVED_SOURCER_ID);
  if (!buyerId || !sourcerId || buyerId === sourcerId) return null;

  const currency = singleToken(env.GP_SANDBOX_CURRENCY)?.toUpperCase() || "";
  if (!CURRENCY.test(currency)) return null;

  const amountRaw = singleToken(env.GP_SANDBOX_MAX_AMOUNT_MINOR);
  if (!amountRaw || !POSITIVE_MINOR.test(amountRaw)) return null;
  const maxAmountMinor = Number(amountRaw);
  if (!Number.isSafeInteger(maxAmountMinor) || maxAmountMinor <= 0) return null;

  const countries = countryAllowlist();
  if (countries.length === 0 || countries.some((code) => !/^[A-Z]{2}$/.test(code))) {
    return null;
  }

  return { enabled: true, buyerId, sourcerId, currency, maxAmountMinor };
}

export function isApprovedSandboxSourcer(userId: string): boolean {
  const pair = readGpSandboxPair();
  return Boolean(pair && pair.sourcerId === userId);
}

export function isApprovedSandboxParticipant(userId: string): boolean {
  const pair = readGpSandboxPair();
  if (!pair) return false;
  return userId === pair.buyerId || userId === pair.sourcerId;
}

/**
 * Decide checkout mode from server-derived participant ids.
 * `ordinaryMode` is the platform mode. No client mode is accepted.
 */
export function decideSandboxCheckout(opts: {
  buyerId: string;
  sellerId: string;
  ordinaryMode?: StripeMode;
}): SandboxCheckoutDecision {
  const pair = readGpSandboxPair();
  if (!pair) return { state: "inactive" };
  const buyerId = opts.buyerId.trim();
  const sellerId = opts.sellerId.trim();
  const buyer = buyerId === pair.buyerId;
  const sourcer = sellerId === pair.sourcerId;
  if (buyer && sourcer) {
    return {
      state: "pair",
      stripeMode: "TEST",
      payoutRail: "STRIPE_GLOBAL_PAYOUTS",
      currency: pair.currency,
      maxAmountMinor: pair.maxAmountMinor,
    };
  }
  if (buyer || sourcer || buyerId === pair.sourcerId || sellerId === pair.buyerId) {
    return { state: "refused", code: "GP_SANDBOX_PAIR_REQUIRED" };
  }
  return {
    state: "ordinary",
    stripeMode: opts.ordinaryMode ?? getStripeMode(),
    payoutRail: "STRIPE_CONNECT",
  };
}

export function sandboxStripeModeForUser(userId: string): StripeMode | null {
  if (!isApprovedSandboxSourcer(userId)) return null;
  return "TEST";
}

export function assertSandboxCommercialTerms(opts: {
  buyerId: string;
  sellerId: string;
  currency: string;
  principalMinor: number;
  paymentOption: string;
}): SandboxCheckoutDecision {
  const decision = decideSandboxCheckout({ buyerId: opts.buyerId, sellerId: opts.sellerId });
  if (decision.state === "refused") {
    throw Object.assign(new Error("This payment is outside the approved test pair."), {
      status: 409,
      code: decision.code,
    });
  }
  if (decision.state !== "pair") return decision;
  if (String(opts.paymentOption || "").toUpperCase() !== "PROTECTED") {
    throw Object.assign(
      new Error("This test payment must use Protected Payment."),
      { status: 409, code: "GP_SANDBOX_PROTECTED_ONLY" },
    );
  }
  const currency = String(opts.currency || "").trim().toUpperCase();
  if (currency !== decision.currency) {
    throw Object.assign(new Error("This test payment currency is not allowed."), {
      status: 409,
      code: "GP_SANDBOX_CURRENCY",
    });
  }
  if (!Number.isInteger(opts.principalMinor) || opts.principalMinor <= 0 || opts.principalMinor > decision.maxAmountMinor) {
    throw Object.assign(new Error("This test payment is above the approved amount limit."), {
      status: 409,
      code: "GP_SANDBOX_AMOUNT_LIMIT",
    });
  }
  return decision;
}

export function evaluateSandboxReleaseLimits(opts: {
  buyerId: string;
  sellerId: string;
  sourceCurrency: string;
  principalMinor: number;
  providerFeeMinor: number;
  crossBorderFeeMinor: number;
  fxFeeMinor: number;
  providerFeeCurrency: string;
  crossBorderFeeCurrency: string;
  fxFeeCurrency: string;
  availableBalanceMinor: number | null;
  checkFunding: boolean;
}):
  | { ok: true; requiredCoverMinor: number; separateFeeMinor: number; capMinor: number }
  | { ok: false; code: string } {
  const pair = readGpSandboxPair();
  if (!pair) return { ok: false, code: "GP_SANDBOX_DISABLED" };
  if (opts.buyerId !== pair.buyerId || opts.sellerId !== pair.sourcerId) {
    return { ok: false, code: "GP_SANDBOX_PAIR_REQUIRED" };
  }
  const sourceCurrency = String(opts.sourceCurrency || "").trim().toUpperCase();
  if (sourceCurrency !== pair.currency) return { ok: false, code: "GP_SANDBOX_CURRENCY" };
  if (!Number.isInteger(opts.principalMinor) || opts.principalMinor <= 0 || opts.principalMinor > pair.maxAmountMinor) {
    return { ok: false, code: "GP_SANDBOX_AMOUNT_LIMIT" };
  }
  const cover = quotedPayoutCover({
    principalMinor: opts.principalMinor,
    sourceCurrency,
    providerFeeMinor: opts.providerFeeMinor,
    crossBorderFeeMinor: opts.crossBorderFeeMinor,
    fxFeeMinor: opts.fxFeeMinor,
    providerFeeCurrency: opts.providerFeeCurrency,
    crossBorderFeeCurrency: opts.crossBorderFeeCurrency,
    fxFeeCurrency: opts.fxFeeCurrency,
  });
  if (!cover.ok) return cover;
  if (cover.requiredCoverMinor > pair.maxAmountMinor) {
    return { ok: false, code: "GP_SANDBOX_AMOUNT_LIMIT" };
  }
  if (opts.checkFunding) {
    if (opts.availableBalanceMinor == null || !Number.isInteger(opts.availableBalanceMinor)) {
      return { ok: false, code: "GP_SANDBOX_FUNDING_UNVERIFIED" };
    }
    if (opts.availableBalanceMinor < cover.requiredCoverMinor) {
      return { ok: false, code: "GP_SANDBOX_FUNDING_SHORT" };
    }
  }
  return {
    ok: true,
    requiredCoverMinor: cover.requiredCoverMinor,
    separateFeeMinor: cover.separateFeeMinor,
    capMinor: pair.maxAmountMinor,
  };
}
