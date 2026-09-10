import type {
  TrustPassportResolveInput,
  TrustPassportTierResult,
} from "@/lib/trust-passport/types";

/**
 * Server-authoritative Bronze / Silver / Gold resolver.
 * Pure — no I/O, no user-editable tier field, no Stripe calls.
 */
export function resolveTrustPassportTier(
  input: TrustPassportResolveInput,
): TrustPassportTierResult {
  if (!input.endorsementAvailable) {
    return {
      available: false,
      tier: null,
      silverEligible: false,
      goldEligible: false,
    };
  }

  const silverEligible =
    input.passportVerified && input.livePayoutsEnabled;
  const goldEligible =
    silverEligible && input.completedProtectedSourcingCount >= 1;

  if (goldEligible) {
    return {
      available: true,
      tier: "GOLD",
      silverEligible: true,
      goldEligible: true,
    };
  }
  if (silverEligible) {
    return {
      available: true,
      tier: "SILVER",
      silverEligible: true,
      goldEligible: false,
    };
  }
  return {
    available: true,
    tier: "BRONZE",
    silverEligible: false,
    goldEligible: false,
  };
}
