import type { Prisma } from "@prisma/client";
import { isLivePaymentsEnabled } from "@/lib/payments/flags";

/**
 * When Live is on, operational admin queues exclude TEST-mode *sourcing*
 * tickets/txns so disposable QA does not clutter live work.
 * Listed-product (PRODUCT_CHECKOUT) rows stay visible regardless of mode.
 * TEST history remains in the database for audit/debug.
 */
export function adminLiveQueueProtectedTxnWhere(): Prisma.ProtectedTransactionWhereInput {
  if (!isLivePaymentsEnabled()) return {};
  return {
    OR: [{ stripeMode: "LIVE" }, { origin: "PRODUCT_CHECKOUT" }],
  };
}

/** Sourcing-only operational list (excludes listed-product checkouts). */
export function adminLiveSourcingProtectedTxnWhere(): Prisma.ProtectedTransactionWhereInput {
  const sourcing: Prisma.ProtectedTransactionWhereInput = {
    origin: { not: "PRODUCT_CHECKOUT" },
  };
  if (!isLivePaymentsEnabled()) return sourcing;
  return { ...sourcing, stripeMode: "LIVE" };
}

export function adminLiveQueueDisputeWhere(
  status: Prisma.DisputeCaseWhereInput["status"],
): Prisma.DisputeCaseWhereInput {
  const where: Prisma.DisputeCaseWhereInput = { status };
  const txnWhere = adminLiveQueueProtectedTxnWhere();
  if (!Object.keys(txnWhere).length) return where;
  return { ...where, protectedTxn: txnWhere };
}

export function adminLiveFailedTransferWhere(): Prisma.TransferAttemptWhereInput {
  const where: Prisma.TransferAttemptWhereInput = { status: "FAILED" };
  if (!isLivePaymentsEnabled()) return where;
  return { ...where, stripeMode: "LIVE" };
}
