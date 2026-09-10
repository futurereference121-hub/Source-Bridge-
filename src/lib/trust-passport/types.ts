/**
 * Trust Passport V1 — safe public/auth DTOs.
 * Never include Connect IDs, PI/txn IDs, amounts, documents, or private PII.
 */

export const TRUST_PASSPORT_TIERS = ["BRONZE", "SILVER", "GOLD"] as const;
export type TrustPassportTier = (typeof TRUST_PASSPORT_TIERS)[number];

export type PassportVerificationState = "Verified" | "Not completed";

export type PayoutAccountState =
  | "Payout Ready"
  | "Not connected"
  | "Action required"
  | "Not ready";

/** Minimal public summary for shield display (no private fields). */
export type TrustPassportPublicSummary = {
  available: boolean;
  tier: TrustPassportTier | null;
};

/** Authenticated detail payload — factual outcomes only. */
export type TrustPassportDetail = {
  available: boolean;
  tier: TrustPassportTier;
  tierLabel: string;
  explanation: string;
  passportVerification: PassportVerificationState;
  payoutAccount: PayoutAccountState;
  completedProtectedSourcingCount: number;
  sourcingHistorySummary: string;
  reviews: {
    averageRating: number | null;
    count: number;
    /** True only when at least one review is tied to a completed legacy transaction. */
    verifiedTransactionReviews: boolean;
  };
  memberSince: string;
  sourcingAreas: Array<{ label: string; selfDeclared: true }>;
  ownerProgression: string | null;
  verificationHref: string | null;
  paymentsHref: string | null;
  /** ISO timestamp — clients must not treat stale responses as authoritative. */
  resolvedAt: string;
};

export type TrustPassportResolveInput = {
  /** Canonical profile tick: identityVerified OR status VERIFIED. */
  passportVerified: boolean;
  /** LIVE Connect row only — TEST never qualifies. */
  livePayoutsEnabled: boolean;
  /** LIVE Connect row exists with a Stripe account id. */
  liveConnectConnected: boolean;
  /** LIVE Connect exists but payouts not enabled. */
  liveConnectNeedsAction: boolean;
  completedProtectedSourcingCount: number;
  endorsementAvailable: boolean;
};

export type TrustPassportTierResult = {
  available: boolean;
  tier: TrustPassportTier | null;
  silverEligible: boolean;
  goldEligible: boolean;
};
