/**
 * Global Payouts RETURNED recovery.
 * Reverses domain transferred counters + ledger when provider returns funds after success.
 * Blocks automatic duplicate repayment until admin clears.
 * Never stores raw bank / PAN data.
 */

import { prisma } from "@/lib/db";
import { appendLedgerEntry, recordAuditEvent } from "@/lib/payments/ledger";
import { sanitizeProviderFailureText } from "@/lib/payments/payout-rail/outbound-display";
import type { ProtectedStatus } from "@/lib/payments/state-machine";

export type HandleReturnedResult =
  | { action: "already_returned" }
  | { action: "ignored_non_terminal"; status: string }
  | {
      action: "returned";
      protectedTxnId: string;
      kind: string;
      amountMinor: number;
      priorStatus: string;
      nextTxnStatus: string;
    };

/**
 * CAS: SUCCEEDED|RECONCILED|PROCESSING → RETURNED, reverse books once.
 * PROCESSING return (never finalized) only marks RETURNED without counter reverse.
 */
export async function handleOutboundReturned(opts: {
  attemptId: string;
  outboundId?: string;
  failureCode?: string | null;
  failureMessage?: string | null;
  actorUserId?: string | null;
}): Promise<HandleReturnedResult> {
  const failureCode = sanitizeProviderFailureText(opts.failureCode || "RETURNED");
  const failureMessage = sanitizeProviderFailureText(
    opts.failureMessage || "Provider returned payout to Financial Account",
  );

  const outcome = await prisma.$transaction(async (tx) => {
    const attempt = await tx.outboundPaymentAttempt.findUnique({
      where: { id: opts.attemptId },
    });
    if (!attempt) {
      return { action: "ignored_non_terminal" as const, status: "MISSING" };
    }
    if (attempt.status === "RETURNED") {
      return { action: "already_returned" as const };
    }

    const wasSucceeded =
      attempt.status === "SUCCEEDED" || attempt.status === "RECONCILED";
    const wasProcessing = attempt.status === "PROCESSING";

    if (!wasSucceeded && !wasProcessing) {
      return {
        action: "ignored_non_terminal" as const,
        status: attempt.status,
      };
    }

    const cas = await tx.outboundPaymentAttempt.updateMany({
      where: {
        id: attempt.id,
        status: { in: ["SUCCEEDED", "RECONCILED", "PROCESSING"] },
      },
      data: {
        status: "RETURNED",
        returnedAt: new Date(),
        lastAttemptAt: new Date(),
        failureCode,
        failureMessage,
        reconciliationNote:
          "Provider returned funds to Financial Account — manual review required; automatic repayment blocked",
        ...(opts.outboundId
          ? { stripeOutboundPaymentId: opts.outboundId }
          : {}),
      },
    });
    if (cas.count !== 1) {
      const fresh = await tx.outboundPaymentAttempt.findUnique({
        where: { id: attempt.id },
      });
      if (fresh?.status === "RETURNED") {
        return { action: "already_returned" as const };
      }
      return {
        action: "ignored_non_terminal" as const,
        status: fresh?.status || "CAS_LOST",
      };
    }

    const txn = await tx.protectedTransaction.findUnique({
      where: { id: attempt.protectedTxnId },
    });
    if (!txn) {
      return {
        action: "returned" as const,
        protectedTxnId: attempt.protectedTxnId,
        kind: attempt.kind,
        amountMinor: attempt.amountMinor,
        priorStatus: "MISSING_TXN",
        nextTxnStatus: "MISSING_TXN",
      };
    }

    let nextTxnStatus = txn.status;
    if (wasSucceeded) {
      if (attempt.kind === "PROCUREMENT") {
        const nextProc = Math.max(
          0,
          txn.procurementTransferredMinor - attempt.amountMinor,
        );
        // Revert to FUNDED when procurement books fully unwind.
        if (
          nextProc === 0 &&
          (txn.status === "PROCUREMENT_RELEASED" ||
            txn.status === "AWAITING_SHIPMENT")
        ) {
          nextTxnStatus = "FUNDED";
        }
        await tx.protectedTransaction.update({
          where: { id: txn.id },
          data: {
            procurementTransferredMinor: nextProc,
            status: nextTxnStatus as ProtectedStatus,
            procurementReleasedAt: nextProc === 0 ? null : txn.procurementReleasedAt,
          },
        });
      } else {
        const nextFinal = Math.max(
          0,
          txn.finalTransferredMinor - attempt.amountMinor,
        );
        // Unwind RELEASED when final books reverse; hold for admin (no auto cron repay).
        if (txn.status === "RELEASED" && nextFinal === 0) {
          nextTxnStatus = "READY_TO_RELEASE";
        } else if (txn.status === "RELEASED" && nextFinal > 0) {
          nextTxnStatus = "PARTIALLY_REFUNDED";
        }
        await tx.protectedTransaction.update({
          where: { id: txn.id },
          data: {
            finalTransferredMinor: nextFinal,
            status: nextTxnStatus as ProtectedStatus,
            releasedAt: nextTxnStatus === "RELEASED" ? txn.releasedAt : null,
          },
        });
      }
    }

    return {
      action: "returned" as const,
      protectedTxnId: txn.id,
      kind: attempt.kind,
      amountMinor: attempt.amountMinor,
      priorStatus: txn.status,
      nextTxnStatus,
      wasSucceeded,
      currency: txn.currency,
      sellerId: txn.sellerId,
      buyerId: txn.buyerId,
      conversationId: txn.conversationId,
      title: txn.title,
      idempotencyKey: attempt.idempotencyKey,
      outboundId: opts.outboundId || attempt.stripeOutboundPaymentId,
    };
  });

  if (outcome.action !== "returned") {
    return outcome;
  }

  // Reverse ledger only when books were previously credited (SUCCEEDED path).
  if ("wasSucceeded" in outcome && outcome.wasSucceeded) {
    await appendLedgerEntry({
      protectedTxnId: outcome.protectedTxnId,
      entryType: "ADJUSTMENT",
      direction: "CREDIT",
      amountMinor: outcome.amountMinor,
      currency: outcome.currency,
      idempotencyKey: `ledger_gp_returned_${outcome.idempotencyKey}`,
      stripeObjectId: outcome.outboundId || "",
      stripeObjectType: "outbound_payment_return",
      meta: {
        rail: "STRIPE_GLOBAL_PAYOUTS",
        reason: "RETURNED",
        kind: outcome.kind,
        reverses:
          outcome.kind === "PROCUREMENT"
            ? "PROCUREMENT_TRANSFER"
            : "FINAL_TRANSFER",
      },
    });
  }

  await recordAuditEvent({
    protectedTxnId: outcome.protectedTxnId,
    actorUserId: opts.actorUserId,
    action: "GP_OUTBOUND_RETURNED",
    reason: failureMessage.slice(0, 200),
    meta: {
      attemptId: opts.attemptId,
      kind: outcome.kind,
      amountMinor: outcome.amountMinor,
      priorStatus: outcome.priorStatus,
      nextTxnStatus: outcome.nextTxnStatus,
      autoRepayBlocked: true,
    },
  });

  try {
    if (outcome.sellerId && outcome.buyerId) {
      const { notifyOutboundPayoutReturned } = await import(
        "@/lib/payment-notifications"
      );
      await notifyOutboundPayoutReturned({
        protectedTxnId: outcome.protectedTxnId,
        sellerId: outcome.sellerId,
        buyerId: outcome.buyerId,
        conversationId: outcome.conversationId || "",
        title: outcome.title || "Protected Payment",
        kind: outcome.kind,
        amountMinor: outcome.amountMinor,
      });
    }
  } catch (err) {
    console.error("[gp:returned:notify]", err instanceof Error ? err.message : "error");
  }

  return {
    action: "returned",
    protectedTxnId: outcome.protectedTxnId,
    kind: outcome.kind,
    amountMinor: outcome.amountMinor,
    priorStatus: outcome.priorStatus,
    nextTxnStatus: outcome.nextTxnStatus,
  };
}
