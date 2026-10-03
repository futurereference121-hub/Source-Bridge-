/**
 * Admin visibility helpers for Global Payouts — queues + safe reconcile actions.
 * Never create duplicate payouts or falsely mark delivered from admin UI alone.
 */

import type { Prisma } from "@prisma/client";
import { isLivePaymentsEnabled } from "@/lib/payments/flags";
import { deriveOutboundDisplayState } from "@/lib/payments/payout-rail/outbound-display";
import {
  combinedAmountMinor,
  planCombineMinimumGroups,
  type CombinableGpEntitlement,
} from "@/lib/payments/payout-rail/combine-minimum";

export function adminLiveFailedOutboundWhere(): Prisma.OutboundPaymentAttemptWhereInput {
  const where: Prisma.OutboundPaymentAttemptWhereInput = {
    status: {
      in: [
        "FAILED",
        "RETURNED",
        "AWAITING_FA_FUNDS",
        "AWAITING_MINIMUM",
        "ACTION_REQUIRED",
        "PROCESSING",
      ],
    },
  };
  if (!isLivePaymentsEnabled()) return where;
  return { ...where, stripeMode: "LIVE" };
}

/** PROCESSING older than threshold — candidate for retrieve reconcile. */
export function adminStuckProcessingWhere(
  olderThan: Date,
): Prisma.OutboundPaymentAttemptWhereInput {
  const where: Prisma.OutboundPaymentAttemptWhereInput = {
    status: "PROCESSING",
    stripeOutboundPaymentId: { not: "" },
    lastAttemptAt: { lte: olderThan },
  };
  if (!isLivePaymentsEnabled()) return where;
  return { ...where, stripeMode: "LIVE" };
}

export type AdminOutboundRow = {
  id: string;
  protectedTxnId: string;
  kind: string;
  amountMinor: number;
  currency: string;
  status: string;
  stripeOutboundPaymentId: string;
  providerFeeMinor: number;
  crossBorderFeeMinor: number;
  fxFeeMinor: number;
  failureCode: string;
  failureMessage: string;
  reconciliationNote: string;
  stripeMode: string;
  lastAttemptAt?: string;
  displayLabel?: string;
  needsAdminAction?: boolean;
  pendingProvider?: boolean;
};

export function enrichAdminOutboundRow(
  row: Omit<AdminOutboundRow, "displayLabel" | "needsAdminAction" | "pendingProvider">,
): AdminOutboundRow {
  const display = deriveOutboundDisplayState(row.status);
  return {
    ...row,
    displayLabel: display.adminLabel,
    needsAdminAction: display.needsAdminAction || row.status === "PROCESSING",
    pendingProvider: display.pendingProvider,
  };
}

export function summarizeCombineMinimumGroups(
  rows: CombinableGpEntitlement[],
): Array<{
  sellerId: string;
  currency: string;
  stripeMode: string;
  count: number;
  combinedMinor: number;
  attemptIds: string[];
}> {
  return planCombineMinimumGroups(rows).map((g) => ({
    sellerId: g[0]!.sellerId,
    currency: g[0]!.currency,
    stripeMode: g[0]!.stripeMode,
    count: g.length,
    combinedMinor: combinedAmountMinor(g),
    attemptIds: g.map((r) => r.attemptId),
  }));
}
