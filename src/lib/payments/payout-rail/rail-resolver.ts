/**
 * Server-authoritative payout rail resolver.
 * Client cannot override. Flag OFF ⇒ Connect-only behaviour identical to today.
 */

import { prisma } from "@/lib/db";
import {
  getStripeMode,
  isGlobalPayoutsEnabled,
  normalizeStripeMode,
  type StripeMode,
} from "@/lib/payments/flags";
import {
  isConnectPayoutCountryUnsupported,
  isGlobalPayoutsCountryAllowed,
  isGlobalPayoutsUserAllowed,
} from "@/lib/payments/payout-rail/eligibility";
import { getSellerConnectFundingState } from "@/lib/payments/stripe/connect";

export type PayoutRail =
  | "STRIPE_CONNECT"
  | "STRIPE_GLOBAL_PAYOUTS"
  | "UNSUPPORTED";

export type PayoutRailResolution = {
  rail: PayoutRail;
  reason: string;
  connectReady: boolean;
  connectHasAccount: boolean;
  gpReady: boolean;
  gpEligibleCountry: boolean;
  country: string;
  /** Universal readiness: Connect ready OR GP recipient+method ready. */
  payoutReady: boolean;
};

function normalizeCountry(raw: string | null | undefined): string {
  return String(raw || "").trim().toUpperCase();
}

export function isGpRecipientPayoutReady(row: {
  status: string;
  payoutMethodReady: boolean;
  defaultPayoutMethodId?: string | null;
  stripeRecipientId?: string | null;
} | null | undefined): boolean {
  if (!row) return false;
  if (!row.stripeRecipientId) return false;
  if (!row.payoutMethodReady) return false;
  if (!String(row.defaultPayoutMethodId || "").trim()) return false;
  const status = String(row.status || "").toUpperCase();
  return status === "ACTIVE";
}

/**
 * Resolve intended rail for a sourcer (pre-fund / onboarding).
 * Priority:
 * 1) Connect ready / in-progress always wins
 * 2) GP master OFF → Connect-only (identical to today)
 * 3) Connect-unsupported country + GP allowlisted → Global Payouts
 * 4) Connect-unsupported + not GP allowlisted → UNSUPPORTED
 * 5) Otherwise stay on Connect onboarding (do not force GP)
 */
export async function resolvePayoutRail(opts: {
  userId: string;
  email?: string | null;
  country?: string | null;
  mode?: StripeMode;
}): Promise<PayoutRailResolution> {
  const mode = normalizeStripeMode(opts.mode ?? getStripeMode());

  const user =
    opts.country != null
      ? { country: opts.country, email: opts.email }
      : await prisma.user.findUnique({
          where: { id: opts.userId },
          select: { country: true, email: true },
        });

  const country = normalizeCountry(user?.country || opts.country);
  const email = opts.email ?? user?.email ?? null;

  const connect = await getSellerConnectFundingState(opts.userId, mode);
  const connectReady = Boolean(connect.ready);
  const connectHasAccount = Boolean(connect.hasAccount);

  if (connectReady) {
    return {
      rail: "STRIPE_CONNECT",
      reason: "connect_ready",
      connectReady: true,
      connectHasAccount: true,
      gpReady: false,
      gpEligibleCountry: false,
      country,
      payoutReady: true,
    };
  }

  // Preserve Connect onboarding in progress — never push GP mid-Connect.
  if (connectHasAccount) {
    return {
      rail: "STRIPE_CONNECT",
      reason: "connect_in_progress",
      connectReady: false,
      connectHasAccount: true,
      gpReady: false,
      gpEligibleCountry: false,
      country,
      payoutReady: false,
    };
  }

  // Flag OFF: exact Connect-only behaviour (never UNSUPPORTED from this layer).
  if (!isGlobalPayoutsEnabled()) {
    return {
      rail: "STRIPE_CONNECT",
      reason: "global_payouts_disabled",
      connectReady: false,
      connectHasAccount: false,
      gpReady: false,
      gpEligibleCountry: false,
      country,
      payoutReady: false,
    };
  }

  const gpEligibleCountry = isGlobalPayoutsCountryAllowed(country);
  const userAllowed = isGlobalPayoutsUserAllowed({
    userId: opts.userId,
    email,
  });
  const connectUnsupported = isConnectPayoutCountryUnsupported(country);

  if (gpEligibleCountry && userAllowed) {
    const gpRow = await prisma.globalPayoutRecipient.findUnique({
      where: {
        userId_stripeMode: { userId: opts.userId, stripeMode: mode },
      },
    });
    const gpReady = isGpRecipientPayoutReady(gpRow);
    return {
      rail: "STRIPE_GLOBAL_PAYOUTS",
      reason: gpReady ? "gp_ready" : "gp_onboarding_required",
      connectReady: false,
      connectHasAccount: false,
      gpReady,
      gpEligibleCountry: true,
      country,
      payoutReady: gpReady,
    };
  }

  // Connect cannot onboard this country and GP policy does not cover it.
  if (connectUnsupported) {
    return {
      rail: "UNSUPPORTED",
      reason: !gpEligibleCountry
        ? "connect_unsupported_country_not_allowlisted"
        : "user_not_allowlisted",
      connectReady: false,
      connectHasAccount: false,
      gpReady: false,
      gpEligibleCountry,
      country,
      payoutReady: false,
    };
  }

  // Default: Connect-supported (or unknown) country → Connect onboarding.
  return {
    rail: "STRIPE_CONNECT",
    reason: "connect_default",
    connectReady: false,
    connectHasAccount: false,
    gpReady: false,
    gpEligibleCountry,
    country,
    payoutReady: false,
  };
}

/** Locked rail on a funded txn — never auto-switch. Empty/legacy ⇒ Connect. */
export function lockedPayoutRailFromTxn(txn: {
  payoutRail?: string | null;
}): "STRIPE_CONNECT" | "STRIPE_GLOBAL_PAYOUTS" {
  const raw = String(txn.payoutRail || "").trim().toUpperCase();
  if (raw === "STRIPE_GLOBAL_PAYOUTS") return "STRIPE_GLOBAL_PAYOUTS";
  return "STRIPE_CONNECT";
}

/**
 * Snapshot to persist at fund lock. Caller must only lock once.
 */
export async function buildPayoutRailLockSnapshot(opts: {
  sellerId: string;
  email?: string | null;
  mode: StripeMode;
}): Promise<{
  payoutRail: "STRIPE_CONNECT" | "STRIPE_GLOBAL_PAYOUTS";
  sellerConnectAccountId: string;
  sellerGpRecipientId: string;
  sellerGpPayoutMethodId: string;
}> {
  const resolved = await resolvePayoutRail({
    userId: opts.sellerId,
    email: opts.email,
    mode: opts.mode,
  });

  if (resolved.rail === "STRIPE_CONNECT" && resolved.connectReady) {
    const connect = await getSellerConnectFundingState(opts.sellerId, opts.mode);
    return {
      payoutRail: "STRIPE_CONNECT",
      sellerConnectAccountId: connect.stripeAccountId || "",
      sellerGpRecipientId: "",
      sellerGpPayoutMethodId: "",
    };
  }

  if (resolved.rail === "STRIPE_GLOBAL_PAYOUTS" && resolved.gpReady) {
    const gp = await prisma.globalPayoutRecipient.findUnique({
      where: {
        userId_stripeMode: {
          userId: opts.sellerId,
          stripeMode: opts.mode,
        },
      },
    });
    return {
      payoutRail: "STRIPE_GLOBAL_PAYOUTS",
      sellerConnectAccountId: "",
      sellerGpRecipientId: gp?.stripeRecipientId || "",
      sellerGpPayoutMethodId: gp?.defaultPayoutMethodId || "",
    };
  }

  throw Object.assign(
    new Error(
      resolved.rail === "UNSUPPORTED"
        ? "Payouts are not yet available in this location."
        : "Sourcer must complete payout setup before this agreement can be funded.",
    ),
    {
      status: 409,
      code:
        resolved.rail === "UNSUPPORTED"
          ? "PAYOUTS_UNAVAILABLE"
          : resolved.rail === "STRIPE_GLOBAL_PAYOUTS"
            ? "GP_NOT_READY"
            : "CONNECT_NOT_READY",
    },
  );
}

/** Universal payout readiness for Trust Passport / Go Live. */
export async function isUniversalPayoutReady(opts: {
  userId: string;
  mode?: StripeMode;
}): Promise<boolean> {
  const mode = normalizeStripeMode(opts.mode ?? getStripeMode());
  const connect = await getSellerConnectFundingState(opts.userId, mode);
  if (connect.payoutsEnabled) return true;

  if (!isGlobalPayoutsEnabled()) return false;
  const gp = await prisma.globalPayoutRecipient.findUnique({
    where: {
      userId_stripeMode: { userId: opts.userId, stripeMode: mode },
    },
  });
  return isGpRecipientPayoutReady(gp);
}
