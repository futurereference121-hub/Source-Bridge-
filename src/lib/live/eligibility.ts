import { prisma } from "@/lib/db";
import { getStripeMode } from "@/lib/payments/flags";
import type { SessionUser } from "@/lib/auth";
import { isLiveStreamingAvailable } from "./flags";
import { isCooldownActive } from "./clock";

export type LiveEligibilityDenial =
  | "FEATURE_UNAVAILABLE"
  | "UNAUTHENTICATED"
  | "ACCOUNT_INACTIVE"
  | "PAYOUTS_REQUIRED"
  | "ACTIVE_LIVE"
  | "COOLDOWN"
  | "ADMIN";

export type LiveEligibility = {
  allowed: boolean;
  reason: LiveEligibilityDenial | null;
  message: string;
  cooldownUntil: string | null;
  serverNow: string;
  payoutsEnabled: boolean;
  available: boolean;
};

function denial(
  reason: LiveEligibilityDenial,
  message: string,
  extra: Partial<LiveEligibility> = {},
): LiveEligibility {
  return {
    allowed: false,
    reason,
    message,
    cooldownUntil: extra.cooldownUntil ?? null,
    serverNow: extra.serverNow ?? new Date().toISOString(),
    payoutsEnabled: extra.payoutsEnabled ?? false,
    available: extra.available ?? isLiveStreamingAvailable(),
  };
}

/**
 * Go Live eligibility. Reads existing Stripe Connect `payoutsEnabled` only.
 * Does not sync Stripe, create Connect accounts, or change payment logic.
 */
export async function evaluateLiveEligibility(
  user: SessionUser | null,
  now: Date = new Date(),
): Promise<LiveEligibility> {
  const serverNow = now.toISOString();
  const available = isLiveStreamingAvailable();
  if (!available) {
    return denial(
      "FEATURE_UNAVAILABLE",
      "Source Bridge Live is not available right now.",
      { serverNow, available: false },
    );
  }
  if (!user) {
    return denial("UNAUTHENTICATED", "Sign in to go Live.", {
      serverNow,
      available,
    });
  }
  if (user.role === "ADMIN" || user.isAdmin) {
    return denial("ADMIN", "Admin accounts cannot go Live.", {
      serverNow,
      available,
    });
  }
  if (
    !user.emailVerified ||
    !user.onboardingComplete ||
    user.isTestAccount
  ) {
    return denial(
      "ACCOUNT_INACTIVE",
      "Finish setting up your Source Bridge account to go Live.",
      { serverNow, available },
    );
  }

  const stripeMode = getStripeMode();
  const connect = await prisma.stripeConnectAccount.findUnique({
    where: {
      userId_stripeMode: { userId: user.id, stripeMode },
    },
    select: { payoutsEnabled: true },
  });
  const payoutsEnabled = Boolean(connect?.payoutsEnabled);
  if (!payoutsEnabled) {
    return denial(
      "PAYOUTS_REQUIRED",
      "Sourcer payouts must be enabled before you can go Live.",
      { serverNow, available, payoutsEnabled: false },
    );
  }

  const active = await prisma.liveSession.findFirst({
    where: {
      broadcasterId: user.id,
      status: { in: ["PREPARING", "LIVE"] },
    },
    select: { id: true },
  });
  if (active) {
    return denial("ACTIVE_LIVE", "You already have a Live in progress.", {
      serverNow,
      available,
      payoutsEnabled,
    });
  }

  const last = await prisma.liveSession.findFirst({
    where: {
      broadcasterId: user.id,
      cooldownUntil: { not: null },
    },
    orderBy: { cooldownUntil: "desc" },
    select: { cooldownUntil: true },
  });
  if (isCooldownActive(last?.cooldownUntil, now)) {
    return denial("COOLDOWN", "Please wait before going Live again.", {
      serverNow,
      available,
      payoutsEnabled,
      cooldownUntil: last!.cooldownUntil!.toISOString(),
    });
  }

  return {
    allowed: true,
    reason: null,
    message: "",
    cooldownUntil: null,
    serverNow,
    payoutsEnabled: true,
    available: true,
  };
}

export function throwEligibilityHttp(el: LiveEligibility): never {
  const err = new Error(el.message) as Error & {
    status: number;
    code: string;
  };
  err.code = el.reason || "LIVE_DENIED";
  if (el.reason === "UNAUTHENTICATED") err.status = 401;
  else if (el.reason === "FEATURE_UNAVAILABLE") err.status = 503;
  else if (el.reason === "COOLDOWN") err.status = 429;
  else err.status = 403;
  throw err;
}
