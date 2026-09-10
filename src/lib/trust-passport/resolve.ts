/**
 * Trust Passport read-only resolver — aggregates canonical stored state.
 * No Stripe API calls, no payment mutations, no user-editable tier field.
 */

import { prisma } from "@/lib/db";
import { isIdentityBadgeVisible } from "@/lib/verification";
import { isTrustPassportEndorsementAvailable } from "@/lib/trust-passport/eligibility";
import { qualifyingSellerCompletionWhere } from "@/lib/trust-passport/history";
import { resolveTrustPassportTier } from "@/lib/trust-passport/tier";
import {
  formatMemberSince,
  ownerProgressionCopy,
  passportVerificationLabel,
  payoutAccountLabel,
  sourcingHistorySummary,
  tierDisplayLabel,
  tierExplanation,
} from "@/lib/trust-passport/copy";
import type {
  TrustPassportDetail,
  TrustPassportPublicSummary,
  TrustPassportResolveInput,
} from "@/lib/trust-passport/types";

const VERIFICATION_HREF = "/profile/settings/verification";
const PAYMENTS_HREF = "/profile/settings/payments";

type UserPassportRow = {
  id: string;
  createdAt: Date;
  deletedAt: Date | null;
  isDemo: boolean;
  isTestAccount: boolean;
  isAdmin: boolean;
  role: string;
  identityVerified: boolean;
  identityVerificationStatus: string;
  specialties: string | null;
  photo: string;
  name: string;
  username: string | null;
  slug: string | null;
};

function parseSpecialties(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

async function loadLiveConnectFlags(userId: string): Promise<{
  livePayoutsEnabled: boolean;
  liveConnectConnected: boolean;
  liveConnectNeedsAction: boolean;
}> {
  // Always read the LIVE row — TEST Connect never qualifies for Silver/Gold.
  const row = await prisma.stripeConnectAccount.findUnique({
    where: {
      userId_stripeMode: { userId, stripeMode: "LIVE" },
    },
    select: {
      stripeAccountId: true,
      payoutsEnabled: true,
    },
  });
  const liveConnectConnected = Boolean(row?.stripeAccountId);
  const livePayoutsEnabled = Boolean(row?.payoutsEnabled);
  return {
    livePayoutsEnabled,
    liveConnectConnected,
    liveConnectNeedsAction: liveConnectConnected && !livePayoutsEnabled,
  };
}

async function countQualifyingSellerCompletions(sellerId: string): Promise<number> {
  return prisma.protectedTransaction.count({
    where: qualifyingSellerCompletionWhere(sellerId),
  });
}

export async function loadTrustPassportFacts(userId: string): Promise<{
  user: UserPassportRow | null;
  input: TrustPassportResolveInput | null;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      createdAt: true,
      deletedAt: true,
      isDemo: true,
      isTestAccount: true,
      isAdmin: true,
      role: true,
      identityVerified: true,
      identityVerificationStatus: true,
      specialties: true,
      photo: true,
      name: true,
      username: true,
      slug: true,
    },
  });
  if (!user) return { user: null, input: null };

  const endorsementAvailable = isTrustPassportEndorsementAvailable({
    ...user,
    isRealAccount: true,
  });

  const [connect, completedProtectedSourcingCount] = await Promise.all([
    loadLiveConnectFlags(userId),
    endorsementAvailable ? countQualifyingSellerCompletions(userId) : Promise.resolve(0),
  ]);

  const passportVerified = isIdentityBadgeVisible(user);

  return {
    user,
    input: {
      passportVerified,
      livePayoutsEnabled: connect.livePayoutsEnabled,
      liveConnectConnected: connect.liveConnectConnected,
      liveConnectNeedsAction: connect.liveConnectNeedsAction,
      completedProtectedSourcingCount,
      endorsementAvailable,
    },
  };
}

/** Public shield summary — no private financial or document fields. */
export async function resolveTrustPassportPublicSummary(
  userId: string,
): Promise<TrustPassportPublicSummary> {
  const { input } = await loadTrustPassportFacts(userId);
  if (!input) return { available: false, tier: null };
  const result = resolveTrustPassportTier(input);
  return { available: result.available, tier: result.tier };
}

export async function resolveTrustPassportDetail(opts: {
  userId: string;
  viewerId: string;
  isOwner: boolean;
}): Promise<TrustPassportDetail | null> {
  const { user, input } = await loadTrustPassportFacts(opts.userId);
  if (!user || !input) return null;

  const tierResult = resolveTrustPassportTier(input);
  if (!tierResult.available || !tierResult.tier) return null;

  const tier = tierResult.tier;

  const [reviewAgg, txnReviewCount] = await Promise.all([
    prisma.review.aggregate({
      where: { revieweeId: opts.userId },
      _avg: { rating: true },
      _count: { rating: true },
    }),
    prisma.review.count({
      where: {
        revieweeId: opts.userId,
        transactionId: { not: null },
      },
    }),
  ]);

  const count = reviewAgg._count.rating || 0;
  const averageRating =
    count > 0 && reviewAgg._avg.rating != null
      ? Math.round(reviewAgg._avg.rating * 10) / 10
      : null;

  const specialties = parseSpecialties(user.specialties);

  return {
    available: true,
    tier,
    tierLabel: tierDisplayLabel(tier),
    explanation: tierExplanation(tier),
    passportVerification: passportVerificationLabel(input.passportVerified),
    payoutAccount: payoutAccountLabel(input),
    completedProtectedSourcingCount: input.completedProtectedSourcingCount,
    sourcingHistorySummary: sourcingHistorySummary(
      tier,
      input.completedProtectedSourcingCount,
    ),
    reviews: {
      averageRating,
      count,
      verifiedTransactionReviews: txnReviewCount > 0,
    },
    memberSince: formatMemberSince(user.createdAt),
    sourcingAreas: specialties.map((label) => ({
      label,
      selfDeclared: true as const,
    })),
    ownerProgression: ownerProgressionCopy(tier, opts.isOwner),
    verificationHref: opts.isOwner ? VERIFICATION_HREF : null,
    paymentsHref: opts.isOwner ? PAYMENTS_HREF : null,
    resolvedAt: new Date().toISOString(),
  };
}

/** Profile header fields for panel (already public on profile). */
export function trustPassportProfileHeader(user: {
  photo: string;
  name: string;
  username: string | null;
}): { photo: string; displayName: string; username: string } {
  return {
    photo: user.photo || "",
    displayName: user.name || "",
    username: user.username || "",
  };
}

/** Assert DTO never carries forbidden keys (tests + runtime sanity). */
export function assertSafeTrustPassportDto(dto: Record<string, unknown>): void {
  const forbidden = [
    "stripeAccountId",
    "stripePaymentIntentId",
    "paymentIntentId",
    "protectedTransactionId",
    "transferId",
    "refundId",
    "passportNumber",
    "documentType",
    "selfie",
    "dateOfBirth",
    "dob",
    "bankAccount",
    "iban",
    "taxId",
    "disabledReason",
    "requirementsJson",
    "buyerId",
    "sellerId",
    "amount",
    "amountMinor",
    "itemAmountMinor",
  ];
  const blob = JSON.stringify(dto);
  for (const key of forbidden) {
    if (Object.prototype.hasOwnProperty.call(dto, key)) {
      throw new Error(`Trust Passport DTO must not include ${key}`);
    }
    // Also reject nested stringified IDs that look like acct_/pi_
    if (key === "stripeAccountId" && /acct_[A-Za-z0-9]+/.test(blob)) {
      throw new Error("Trust Passport DTO must not include Connect account IDs");
    }
  }
}
