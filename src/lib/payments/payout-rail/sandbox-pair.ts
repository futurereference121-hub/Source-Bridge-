/**
 * Production Global Payouts Sandbox pair.
 * Server-controlled and fail-closed. Client fields, usernames, headers, and
 * URL parameters cannot select TEST mode.
 *
 * Identified participants never fall through to ordinary LIVE checkout.
 * GLOBAL_PAYOUTS_SANDBOX_ENABLED=false stops new purchases, quotes, payouts,
 * and retries while GLOBAL_PAYOUTS_ENABLED stays on so webhook reconciliation
 * still applies. Turning the master flag off acknowledges events without
 * applying them and is not the stop control.
 */

import {
  getStripeMode,
  isGlobalPayoutsEnabled,
  isGlobalPayoutsSandboxEnabled,
  normalizeStripeMode,
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
  | {
      state: "refused";
      code:
        | "GP_SANDBOX_PAIR_REQUIRED"
        | "GP_SANDBOX_INITIATION_DISABLED"
        | "GP_SANDBOX_CONFIG_INVALID";
    };

export type SandboxIdHold = {
  buyerId: string | null;
  sourcerId: string | null;
};

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

function liveInitiationRequested(env: NodeJS.ProcessEnv): boolean {
  const liveInitiation = String(env.GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED || "")
    .trim()
    .toLowerCase();
  return (
    liveInitiation === "1" ||
    liveInitiation === "true" ||
    liveInitiation === "yes" ||
    liveInitiation === "on"
  );
}

function commercialConfig(
  env: NodeJS.ProcessEnv,
): { currency: string; maxAmountMinor: number } | null {
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
  return { currency, maxAmountMinor };
}

/**
 * Valid participant ids, even when initiation or the rest of the configuration
 * is off. The same valid id in both fields is still that designated participant.
 */
export function readGpSandboxIdHold(
  env: NodeJS.ProcessEnv = process.env,
): SandboxIdHold | null {
  const buyerId = immutableUserId(env.GP_SANDBOX_APPROVED_BUYER_ID);
  const sourcerId = immutableUserId(env.GP_SANDBOX_APPROVED_SOURCER_ID);
  if (!buyerId && !sourcerId) return null;
  return { buyerId, sourcerId };
}

function identicalParticipantIds(hold: SandboxIdHold): boolean {
  return Boolean(hold.buyerId && hold.sourcerId && hold.buyerId === hold.sourcerId);
}

export function readGpSandboxPair(
  env: NodeJS.ProcessEnv = process.env,
): SandboxPairConfig | null {
  if (!isGlobalPayoutsEnabled()) return null;
  if (!isGlobalPayoutsSandboxEnabled()) return null;
  if (liveInitiationRequested(env)) return null;
  const hold = readGpSandboxIdHold(env);
  if (!hold?.buyerId || !hold.sourcerId || identicalParticipantIds(hold)) return null;
  const commercial = commercialConfig(env);
  if (!commercial) return null;
  return {
    enabled: true,
    buyerId: hold.buyerId,
    sourcerId: hold.sourcerId,
    currency: commercial.currency,
    maxAmountMinor: commercial.maxAmountMinor,
  };
}

/**
 * Currency the normal ticket form may offer when these two participants are
 * the approved Sandbox pair in one direction. Null for every other pair.
 * The checkout decision remains authoritative at submit.
 */
export function sandboxTicketCurrencyPolicy(
  participantA: string,
  participantB: string,
): { buyerId: string; sellerId: string; currency: string } | null {
  const a = participantA.trim();
  const b = participantB.trim();
  if (!a || !b || a === b) return null;
  const forward = decideSandboxCheckout({ buyerId: a, sellerId: b });
  if (forward.state === "pair") {
    return { buyerId: a, sellerId: b, currency: forward.currency };
  }
  const reverse = decideSandboxCheckout({ buyerId: b, sellerId: a });
  if (reverse.state === "pair") {
    return { buyerId: b, sellerId: a, currency: reverse.currency };
  }
  return null;
}

export function isApprovedSandboxSourcer(userId: string): boolean {
  const hold = readGpSandboxIdHold();
  return Boolean(hold?.sourcerId && hold.sourcerId === userId);
}

export function isApprovedSandboxParticipant(userId: string): boolean {
  const hold = readGpSandboxIdHold();
  if (!hold) return false;
  return userId === hold.buyerId || userId === hold.sourcerId;
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
  const hold = readGpSandboxIdHold();
  if (!hold) return { state: "inactive" };
  const buyerId = opts.buyerId.trim();
  const sellerId = opts.sellerId.trim();
  const involved =
    (hold.buyerId != null && (buyerId === hold.buyerId || sellerId === hold.buyerId)) ||
    (hold.sourcerId != null && (buyerId === hold.sourcerId || sellerId === hold.sourcerId));
  if (!involved) {
    return {
      state: "ordinary",
      stripeMode: opts.ordinaryMode ?? getStripeMode(),
      payoutRail: "STRIPE_CONNECT",
    };
  }

  if (identicalParticipantIds(hold)) {
    return { state: "refused", code: "GP_SANDBOX_CONFIG_INVALID" };
  }

  const pair = readGpSandboxPair();
  if (pair && buyerId === pair.buyerId && sellerId === pair.sourcerId) {
    return {
      state: "pair",
      stripeMode: "TEST",
      payoutRail: "STRIPE_GLOBAL_PAYOUTS",
      currency: pair.currency,
      maxAmountMinor: pair.maxAmountMinor,
    };
  }

  const exact = Boolean(
    hold.buyerId &&
      hold.sourcerId &&
      buyerId === hold.buyerId &&
      sellerId === hold.sourcerId,
  );
  if (
    exact &&
    isGlobalPayoutsEnabled() &&
    !liveInitiationRequested(process.env) &&
    commercialConfig(process.env) &&
    !isGlobalPayoutsSandboxEnabled()
  ) {
    return { state: "refused", code: "GP_SANDBOX_INITIATION_DISABLED" };
  }
  if (exact || !hold.buyerId || !hold.sourcerId) {
    return { state: "refused", code: "GP_SANDBOX_CONFIG_INVALID" };
  }
  return { state: "refused", code: "GP_SANDBOX_PAIR_REQUIRED" };
}

export function sandboxStripeModeForUser(userId: string): StripeMode | null {
  if (!isApprovedSandboxSourcer(userId)) return null;
  return "TEST";
}

/**
 * Mode for Global Payouts onboarding, return sync, and status.
 * The approved Sandbox sourcer stays TEST even when initiation is off.
 * Any explicit mode is ignored for that sourcer, so a client cannot select LIVE.
 * Everyone else keeps the supplied mode or the platform mode.
 */
export function gpModeForUser(userId: string, mode?: StripeMode): StripeMode {
  const sandbox = sandboxStripeModeForUser(userId);
  if (sandbox) return sandbox;
  if (mode) return normalizeStripeMode(mode);
  return getStripeMode();
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
    const message =
      decision.code === "GP_SANDBOX_INITIATION_DISABLED"
        ? "New test payments are stopped."
        : decision.code === "GP_SANDBOX_CONFIG_INVALID"
          ? "This test payment is not available."
          : "This payment is outside the approved test pair.";
    throw Object.assign(new Error(message), {
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
