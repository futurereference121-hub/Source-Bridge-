import type {
  PassportVerificationState,
  PayoutAccountState,
  TrustPassportTier,
} from "@/lib/trust-passport/types";
import { formatProtectedSourcingCount } from "@/lib/trust-passport/history";

export function tierDisplayLabel(tier: TrustPassportTier): string {
  switch (tier) {
    case "GOLD":
      return "GOLD — SUCCESSFUL SOURCER";
    case "SILVER":
      return "SILVER — VERIFIED & PAYOUT READY";
    case "BRONZE":
    default:
      return "BRONZE MEMBER";
  }
}

export function tierExplanation(tier: TrustPassportTier): string {
  switch (tier) {
    case "GOLD":
      return "This member is verified, payout ready and has successfully completed protected sourcing through Source Bridge.";
    case "SILVER":
      return "This member has completed Source Bridge passport verification and has an active payout account.";
    case "BRONZE":
    default:
      return "This member has a Source Bridge account but has not yet completed every verification step required for Silver.";
  }
}

export function shieldAriaLabel(tier: TrustPassportTier): string {
  switch (tier) {
    case "GOLD":
      return "Gold Trust Passport — successful Sourcer";
    case "SILVER":
      return "Silver Trust Passport — verified and payout ready";
    case "BRONZE":
    default:
      return "Bronze Trust Passport";
  }
}

export function ownerProgressionCopy(
  tier: TrustPassportTier,
  isOwner: boolean,
): string | null {
  if (!isOwner) return null;
  switch (tier) {
    case "BRONZE":
      return "Complete Source Bridge passport verification and activate your payout account to reach Silver.";
    case "SILVER":
      return "Complete your first protected sourcing transaction to reach Gold.";
    case "GOLD":
      return "Gold reflects verified payout readiness and completed protected sourcing history.";
    default:
      return null;
  }
}

export function passportVerificationLabel(
  verified: boolean,
): PassportVerificationState {
  return verified ? "Verified" : "Not completed";
}

export function payoutAccountLabel(input: {
  livePayoutsEnabled: boolean;
  liveConnectConnected: boolean;
  liveConnectNeedsAction: boolean;
}): PayoutAccountState {
  if (input.livePayoutsEnabled) return "Payout Ready";
  if (!input.liveConnectConnected) return "Not connected";
  if (input.liveConnectNeedsAction) return "Action required";
  return "Not ready";
}

export function sourcingHistorySummary(
  tier: TrustPassportTier,
  count: number,
): string {
  if (count > 0) return formatProtectedSourcingCount(count);
  return "No completed protected sourcings yet.";
}

export function formatMemberSince(joinedAt: Date | string | null | undefined): string {
  if (!joinedAt) return "Member since —";
  const d = typeof joinedAt === "string" ? new Date(joinedAt) : joinedAt;
  if (Number.isNaN(d.getTime())) return "Member since —";
  const label = d.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return `Member since ${label}`;
}
