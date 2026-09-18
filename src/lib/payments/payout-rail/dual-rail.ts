/**
 * Dual-rail defense: one locked payout rail per protected payment stage.
 * Prevents Connect transfer AND Global Payouts OutboundPayment for the same stage.
 * Does not change Connect fee / transfer architecture — only adds pre-flight guards.
 */

import { prisma } from "@/lib/db";

export type PayoutStageKind = "PROCUREMENT" | "FINAL";

const GP_BLOCKING_STATUSES = ["SUCCEEDED", "PROCESSING", "RECONCILED"] as const;

/**
 * Throws if a Global Payouts attempt already succeeded or is in-flight for this stage.
 * Connect path must call this before transfers.create.
 */
export async function assertNoGpBlockingAttempt(
  protectedTxnId: string,
  kind: PayoutStageKind,
): Promise<void> {
  const existing = await prisma.outboundPaymentAttempt.findFirst({
    where: {
      protectedTxnId,
      kind,
      status: { in: [...GP_BLOCKING_STATUSES] },
    },
    select: { id: true, status: true, stripeOutboundPaymentId: true },
  });
  if (!existing) return;

  if (existing.status === "SUCCEEDED" || existing.status === "RECONCILED") {
    throw Object.assign(
      new Error(
        "Global Payouts already succeeded for this stage — refusing Connect transfer (dual-rail)",
      ),
      {
        status: 409,
        code: "DUAL_RAIL_BLOCKED",
        needsAdminReview: true,
        gpAttemptId: existing.id,
        gpStatus: existing.status,
      },
    );
  }

  throw Object.assign(
    new Error(
      "Global Payouts outbound payment already in progress — refusing Connect transfer (dual-rail)",
    ),
    {
      status: 409,
      code: "DUAL_RAIL_BLOCKED",
      needsAdminReview: true,
      gpAttemptId: existing.id,
      gpStatus: existing.status,
    },
  );
}

/**
 * Throws if a Connect TransferAttempt already succeeded for this stage.
 * GP path must call this before creating an OutboundPayment.
 */
export async function assertNoConnectTransferSucceeded(
  protectedTxnId: string,
  kind: PayoutStageKind,
): Promise<void> {
  const existing = await prisma.transferAttempt.findFirst({
    where: {
      protectedTxnId,
      kind,
      status: "SUCCEEDED",
    },
    select: { id: true, stripeTransferId: true },
  });
  if (!existing) return;

  throw Object.assign(
    new Error(
      "Connect transfer already succeeded for this stage — refusing Global Payouts (dual-rail)",
    ),
    {
      status: 409,
      code: "DUAL_RAIL_BLOCKED",
      needsAdminReview: true,
      transferAttemptId: existing.id,
    },
  );
}

/**
 * True when a GP attempt for this stage already reached SUCCEEDED (idempotent short-circuit).
 */
export async function hasGpSucceeded(
  protectedTxnId: string,
  kind: PayoutStageKind,
): Promise<boolean> {
  const existing = await prisma.outboundPaymentAttempt.findFirst({
    where: {
      protectedTxnId,
      kind,
      status: { in: ["SUCCEEDED", "RECONCILED"] },
    },
    select: { id: true },
  });
  return Boolean(existing);
}

/**
 * True when a RETURNED attempt exists for the same idempotency key —
 * auto-retry must be blocked until admin clears / re-keys.
 */
export async function hasReturnedOutboundBlockingRetry(
  idempotencyKey: string,
): Promise<boolean> {
  const existing = await prisma.outboundPaymentAttempt.findUnique({
    where: { idempotencyKey },
    select: { status: true },
  });
  return existing?.status === "RETURNED";
}
