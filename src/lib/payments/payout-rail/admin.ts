/**
 * Admin visibility helpers for Global Payouts — read-only queues.
 * Never create duplicate payouts or falsely mark delivered from admin UI alone.
 */

import type { Prisma } from "@prisma/client";
import { isLivePaymentsEnabled } from "@/lib/payments/flags";

export function adminLiveFailedOutboundWhere(): Prisma.OutboundPaymentAttemptWhereInput {
  const where: Prisma.OutboundPaymentAttemptWhereInput = {
    status: { in: ["FAILED", "RETURNED", "AWAITING_FA_FUNDS", "AWAITING_MINIMUM", "ACTION_REQUIRED"] },
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
};
