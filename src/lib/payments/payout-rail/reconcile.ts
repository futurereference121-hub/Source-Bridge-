/**
 * Stuck PROCESSING reconciler for Global Payouts OutboundPayments.
 * Retrieves authoritative Stripe state — never infers success from elapsed time alone.
 * Idempotent under concurrent webhooks (CAS finalize / returned handlers).
 */

import { prisma } from "@/lib/db";
import {
  assertStripeModeCompatible,
  isGlobalPayoutsEnabled,
  normalizeStripeMode,
  type StripeMode,
} from "@/lib/payments/flags";
import { gpErrorMessage, gpFetch } from "@/lib/payments/payout-rail/gp-client";
import { mapOutboundPaymentProviderStatus } from "@/lib/payments/payout-rail/status-mapper";
import { finalizeOutboundSuccess } from "@/lib/payments/payout-rail/outbound-payment";
import { handleOutboundReturned } from "@/lib/payments/payout-rail/returned";
import { sanitizeProviderFailureText } from "@/lib/payments/payout-rail/outbound-display";
import type { ProtectedStatus } from "@/lib/payments/state-machine";

/** Default: only reconcile attempts older than 15 minutes. */
export const GP_STUCK_PROCESSING_THRESHOLD_MS = 15 * 60 * 1000;

export type ReconcileOutboundResult = {
  attemptId: string;
  action:
    | "skipped_disabled"
    | "skipped_no_provider_id"
    | "skipped_fresh"
    | "retrieve_failed"
    | "unchanged"
    | "finalized"
    | "already_finalized"
    | "marked_failed"
    | "marked_returned"
    | "marked_action_required"
    | "error";
  providerStatus?: string;
  message?: string;
};

/**
 * Retrieve one outbound payment and apply domain updates if status advanced.
 */
export async function reconcileOutboundAttempt(opts: {
  attemptId: string;
  /** When true, skip age threshold (admin explicit reconcile). */
  force?: boolean;
  actorUserId?: string | null;
  stuckThresholdMs?: number;
}): Promise<ReconcileOutboundResult> {
  if (!isGlobalPayoutsEnabled()) {
    return { attemptId: opts.attemptId, action: "skipped_disabled" };
  }

  const attempt = await prisma.outboundPaymentAttempt.findUnique({
    where: { id: opts.attemptId },
  });
  if (!attempt) {
    return { attemptId: opts.attemptId, action: "error", message: "not_found" };
  }

  if (attempt.status !== "PROCESSING") {
    if (attempt.status === "SUCCEEDED" || attempt.status === "RECONCILED") {
      return { attemptId: attempt.id, action: "already_finalized" };
    }
    return {
      attemptId: attempt.id,
      action: "unchanged",
      providerStatus: attempt.status,
    };
  }

  if (!attempt.stripeOutboundPaymentId) {
    return { attemptId: attempt.id, action: "skipped_no_provider_id" };
  }

  const threshold = opts.stuckThresholdMs ?? GP_STUCK_PROCESSING_THRESHOLD_MS;
  const ageMs = Date.now() - new Date(attempt.lastAttemptAt).getTime();
  if (!opts.force && ageMs < threshold) {
    return { attemptId: attempt.id, action: "skipped_fresh" };
  }

  const mode = normalizeStripeMode(attempt.stripeMode as StripeMode);
  try {
    assertStripeModeCompatible(mode);
  } catch {
    return {
      attemptId: attempt.id,
      action: "skipped_disabled",
      message: "mode_incompatible",
    };
  }

  // Read-only retrieve — never creates payout objects.
  const retrieved = await gpFetch({
    mode,
    method: "GET",
    path: `/v2/money_management/outbound_payments/${encodeURIComponent(attempt.stripeOutboundPaymentId)}`,
    moneyMutation: false,
  });

  if (!retrieved.ok) {
    return {
      attemptId: attempt.id,
      action: "retrieve_failed",
      message: sanitizeProviderFailureText(gpErrorMessage(retrieved)),
    };
  }

  const mapped = mapOutboundPaymentProviderStatus(retrieved.body);

  if (mapped === "SUCCEEDED") {
    const txn = await prisma.protectedTransaction.findUnique({
      where: { id: attempt.protectedTxnId },
    });
    if (!txn) {
      return { attemptId: attempt.id, action: "error", message: "txn_missing" };
    }
    const isFullResidual =
      attempt.kind !== "FINAL" || !attempt.idempotencyKey.includes("_admin_");
    const result = await finalizeOutboundSuccess({
      attemptId: attempt.id,
      outboundId: attempt.stripeOutboundPaymentId,
      txn,
      status: txn.status as ProtectedStatus,
      domainAction:
        attempt.kind === "PROCUREMENT" ? "RELEASE_PROCUREMENT" : "RELEASE_FINAL",
      kind: attempt.kind === "PROCUREMENT" ? "PROCUREMENT" : "FINAL",
      amount: attempt.amountMinor,
      idempotencyKey: attempt.idempotencyKey,
      isFullResidual,
      actorUserId: opts.actorUserId,
      providerBody: retrieved.body,
    });
    return {
      attemptId: attempt.id,
      action: result.alreadyReleased ? "already_finalized" : "finalized",
      providerStatus: mapped,
    };
  }

  if (mapped === "RETURNED") {
    await handleOutboundReturned({
      attemptId: attempt.id,
      outboundId: attempt.stripeOutboundPaymentId,
      failureCode: "RETURNED",
      failureMessage: "Reconcile retrieved RETURNED status",
      actorUserId: opts.actorUserId,
    });
    return {
      attemptId: attempt.id,
      action: "marked_returned",
      providerStatus: mapped,
    };
  }

  if (mapped === "FAILED") {
    await prisma.outboundPaymentAttempt.updateMany({
      where: { id: attempt.id, status: "PROCESSING" },
      data: {
        status: "FAILED",
        failureCode: "PROVIDER_FAILED",
        failureMessage: sanitizeProviderFailureText(
          String(
            (retrieved.body as { failure_message?: string }).failure_message ||
              "Outbound payment failed",
          ),
        ),
        lastAttemptAt: new Date(),
      },
    });
    return {
      attemptId: attempt.id,
      action: "marked_failed",
      providerStatus: mapped,
    };
  }

  if (mapped === "ACTION_REQUIRED") {
    await prisma.outboundPaymentAttempt.updateMany({
      where: { id: attempt.id, status: "PROCESSING" },
      data: {
        status: "ACTION_REQUIRED",
        failureCode: "ACTION_REQUIRED",
        lastAttemptAt: new Date(),
      },
    });
    return {
      attemptId: attempt.id,
      action: "marked_action_required",
      providerStatus: mapped,
    };
  }

  // Still processing at provider — touch lastAttemptAt lightly so cron does not hammer.
  await prisma.outboundPaymentAttempt.updateMany({
    where: { id: attempt.id, status: "PROCESSING" },
    data: { lastAttemptAt: new Date() },
  });
  return {
    attemptId: attempt.id,
    action: "unchanged",
    providerStatus: mapped,
  };
}

/**
 * Batch reconcile stuck PROCESSING attempts (cron / admin).
 * Never marks success from time alone — always retrieves.
 */
export async function reconcileStuckOutboundPayments(opts?: {
  limit?: number;
  stuckThresholdMs?: number;
  actorUserId?: string | null;
}): Promise<{ scanned: number; results: ReconcileOutboundResult[] }> {
  if (!isGlobalPayoutsEnabled()) {
    return { scanned: 0, results: [] };
  }

  const limit = Math.min(50, Math.max(1, opts?.limit ?? 25));
  const threshold = opts?.stuckThresholdMs ?? GP_STUCK_PROCESSING_THRESHOLD_MS;
  const cutoff = new Date(Date.now() - threshold);

  const rows = await prisma.outboundPaymentAttempt.findMany({
    where: {
      status: "PROCESSING",
      stripeOutboundPaymentId: { not: "" },
      lastAttemptAt: { lte: cutoff },
    },
    orderBy: { lastAttemptAt: "asc" },
    take: limit,
    select: { id: true },
  });

  const results: ReconcileOutboundResult[] = [];
  for (const row of rows) {
    try {
      results.push(
        await reconcileOutboundAttempt({
          attemptId: row.id,
          force: true,
          actorUserId: opts?.actorUserId,
          stuckThresholdMs: threshold,
        }),
      );
    } catch (err) {
      results.push({
        attemptId: row.id,
        action: "error",
        message: err instanceof Error ? err.message.slice(0, 200) : "error",
      });
    }
  }

  return { scanned: rows.length, results };
}
