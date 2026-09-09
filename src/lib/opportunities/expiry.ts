import type { CreatableOpportunityKind } from "@/lib/opportunities/kinds";

const DAY_MS = 24 * 60 * 60 * 1000;

export const BUYER_REQUEST_DEFAULT_DAYS = 14;
export const SOURCING_OFFER_DEFAULT_DAYS = 30;
/** Notify this many ms before expiresAt. */
export const PRE_EXPIRY_NOTIFY_WINDOW_MS = 48 * 60 * 60 * 1000;

type ExpiryInput = {
  kind: CreatableOpportunityKind;
  now?: Date;
  /** Buyer Request explicit deadline. */
  deadline?: Date | null;
  /** Sourcing Offer earlier availability end. */
  availabilityEndsAt?: Date | null;
  /** Travel Opportunity travel end (required for travel). */
  travelEndAt?: Date | null;
};

/**
 * Server-authoritative expiresAt defaults:
 * - Buyer Request: deadline or now+14d
 * - Travel: travel end
 * - Sourcing Offer: availability end or now+30d
 */
export function computeOpportunityExpiresAt(input: ExpiryInput): Date {
  const now = input.now ?? new Date();
  switch (input.kind) {
    case "BUYER_REQUEST": {
      if (input.deadline && !Number.isNaN(input.deadline.getTime())) {
        return input.deadline;
      }
      return new Date(now.getTime() + BUYER_REQUEST_DEFAULT_DAYS * DAY_MS);
    }
    case "TRAVEL_OPPORTUNITY": {
      if (!input.travelEndAt || Number.isNaN(input.travelEndAt.getTime())) {
        throw new Error("Travel end date required");
      }
      return input.travelEndAt;
    }
    case "SOURCING_OFFER": {
      if (
        input.availabilityEndsAt &&
        !Number.isNaN(input.availabilityEndsAt.getTime())
      ) {
        return input.availabilityEndsAt;
      }
      return new Date(now.getTime() + SOURCING_OFFER_DEFAULT_DAYS * DAY_MS);
    }
    default: {
      const _exhaustive: never = input.kind;
      return _exhaustive;
    }
  }
}

export function isPastExpiry(expiresAt: Date | null | undefined, now = new Date()): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() <= now.getTime();
}

export function isInPreExpiryWindow(
  expiresAt: Date | null | undefined,
  now = new Date(),
): boolean {
  if (!expiresAt) return false;
  const t = expiresAt.getTime();
  const n = now.getTime();
  return t > n && t - n <= PRE_EXPIRY_NOTIFY_WINDOW_MS;
}
