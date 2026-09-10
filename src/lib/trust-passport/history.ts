/**
 * Read-only qualifying history for Trust Passport Gold.
 * Does not mutate payment records. Counts existing LIVE ProtectedTransaction
 * rows where the user was seller and fulfilment reached RELEASED.
 */

import type { Prisma } from "@prisma/client";

/**
 * Universal seller-success filter — account-agnostic.
 * Includes chat tickets and listed-product checkouts when RELEASED on LIVE.
 */
export function qualifyingSellerCompletionWhere(
  sellerId: string,
): Prisma.ProtectedTransactionWhereInput {
  return {
    sellerId,
    stripeMode: "LIVE",
    status: "RELEASED",
    fundedAt: { not: null },
  };
}

/** Exact buyer-facing count label (singular/plural). */
export function formatProtectedSourcingCount(count: number): string {
  const n = Math.max(0, Math.floor(count));
  if (n === 1) return "1 protected sourcing completed";
  return `${n} protected sourcings completed`;
}

export function sourcingHistoryEmptySummary(tier: "BRONZE" | "SILVER" | "GOLD"): string {
  if (tier === "SILVER") {
    return "No completed protected sourcings yet.";
  }
  if (tier === "GOLD") {
    return formatProtectedSourcingCount(0);
  }
  return "No completed protected sourcings yet.";
}
