/**
 * Admin-only Global Payouts reconcile / review actions.
 * Retrieve-only against Stripe — never creates OutboundPayment objects.
 * Does not bypass dual-rail or auto-repay RETURNED attempts.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/validation";
import { isGlobalPayoutsEnabled } from "@/lib/payments/flags";
import {
  reconcileOutboundAttempt,
  reconcileStuckOutboundPayments,
  GP_STUCK_PROCESSING_THRESHOLD_MS,
} from "@/lib/payments/payout-rail/reconcile";
import {
  adminLiveFailedOutboundWhere,
  adminStuckProcessingWhere,
  enrichAdminOutboundRow,
  summarizeCombineMinimumGroups,
} from "@/lib/payments/payout-rail/admin";
import { recordAuditEvent } from "@/lib/payments/ledger";

export const runtime = "nodejs";

const postSchema = z.object({
  action: z.enum(["reconcile_one", "reconcile_stuck"]),
  attemptId: z.string().trim().min(1).optional(),
  confirmed: z.literal(true),
});

export async function GET() {
  try {
    await requireAdmin();
    if (!isGlobalPayoutsEnabled()) {
      return Response.json({
        ok: true,
        enabled: false,
        issues: [],
        stuck: [],
        combineGroups: [],
      });
    }

    const cutoff = new Date(Date.now() - GP_STUCK_PROCESSING_THRESHOLD_MS);
    const [issues, stuck, awaitingMin] = await Promise.all([
      prisma.outboundPaymentAttempt.findMany({
        where: adminLiveFailedOutboundWhere(),
        orderBy: { lastAttemptAt: "desc" },
        take: 40,
        select: {
          id: true,
          protectedTxnId: true,
          kind: true,
          amountMinor: true,
          currency: true,
          status: true,
          stripeOutboundPaymentId: true,
          providerFeeMinor: true,
          crossBorderFeeMinor: true,
          fxFeeMinor: true,
          failureCode: true,
          failureMessage: true,
          reconciliationNote: true,
          stripeMode: true,
          lastAttemptAt: true,
          stripeRecipientId: true,
          protectedTxn: { select: { sellerId: true } },
        },
      }),
      prisma.outboundPaymentAttempt.findMany({
        where: adminStuckProcessingWhere(cutoff),
        orderBy: { lastAttemptAt: "asc" },
        take: 25,
        select: {
          id: true,
          protectedTxnId: true,
          kind: true,
          amountMinor: true,
          currency: true,
          status: true,
          stripeOutboundPaymentId: true,
          providerFeeMinor: true,
          crossBorderFeeMinor: true,
          fxFeeMinor: true,
          failureCode: true,
          failureMessage: true,
          reconciliationNote: true,
          stripeMode: true,
          lastAttemptAt: true,
        },
      }),
      prisma.outboundPaymentAttempt.findMany({
        where: { status: "AWAITING_MINIMUM" },
        take: 50,
        select: {
          id: true,
          amountMinor: true,
          currency: true,
          stripeMode: true,
          status: true,
          protectedTxn: { select: { sellerId: true } },
        },
      }),
    ]);

    const combineGroups = summarizeCombineMinimumGroups(
      awaitingMin.map((r) => ({
        attemptId: r.id,
        sellerId: r.protectedTxn.sellerId,
        currency: r.currency,
        amountMinor: r.amountMinor,
        stripeMode: r.stripeMode,
        status: r.status,
      })),
    );

    return Response.json({
      ok: true,
      enabled: true,
      stuckThresholdMs: GP_STUCK_PROCESSING_THRESHOLD_MS,
      issues: issues.map((r) =>
        enrichAdminOutboundRow({
          id: r.id,
          protectedTxnId: r.protectedTxnId,
          kind: r.kind,
          amountMinor: r.amountMinor,
          currency: r.currency,
          status: r.status,
          stripeOutboundPaymentId: r.stripeOutboundPaymentId,
          providerFeeMinor: r.providerFeeMinor,
          crossBorderFeeMinor: r.crossBorderFeeMinor,
          fxFeeMinor: r.fxFeeMinor,
          failureCode: r.failureCode,
          failureMessage: r.failureMessage,
          reconciliationNote: r.reconciliationNote,
          stripeMode: r.stripeMode,
          lastAttemptAt: r.lastAttemptAt.toISOString(),
        }),
      ),
      stuck: stuck.map((r) =>
        enrichAdminOutboundRow({
          id: r.id,
          protectedTxnId: r.protectedTxnId,
          kind: r.kind,
          amountMinor: r.amountMinor,
          currency: r.currency,
          status: r.status,
          stripeOutboundPaymentId: r.stripeOutboundPaymentId,
          providerFeeMinor: r.providerFeeMinor,
          crossBorderFeeMinor: r.crossBorderFeeMinor,
          fxFeeMinor: r.fxFeeMinor,
          failureCode: r.failureCode,
          failureMessage: r.failureMessage,
          reconciliationNote: r.reconciliationNote,
          stripeMode: r.stripeMode,
          lastAttemptAt: r.lastAttemptAt.toISOString(),
        }),
      ),
      combineGroups,
    });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    if (status === 401 || status === 403) {
      return jsonError("Admin required", status);
    }
    console.error("[admin:gp-reconcile:get]", err);
    return jsonError("Failed to load GP queue", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    if (!isGlobalPayoutsEnabled()) {
      return jsonError("Global Payouts are not enabled", 503, {
        code: "GP_DISABLED",
      });
    }

    const body = await req.json().catch(() => ({}));
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }

    if (parsed.data.action === "reconcile_stuck") {
      const batch = await reconcileStuckOutboundPayments({
        limit: 25,
        actorUserId: admin.id,
      });
      await recordAuditEvent({
        actorUserId: admin.id,
        action: "GP_ADMIN_RECONCILE_STUCK",
        meta: { scanned: batch.scanned, results: batch.results.length },
      });
      return Response.json({ ok: true, ...batch });
    }

    const attemptId = parsed.data.attemptId;
    if (!attemptId) {
      return jsonError("attemptId required", 400);
    }

    const attempt = await prisma.outboundPaymentAttempt.findUnique({
      where: { id: attemptId },
    });
    if (!attempt) return jsonError("Attempt not found", 404);

    if (attempt.status === "RETURNED") {
      return jsonError(
        "Returned payouts require manual review — reconcile will not auto-repay",
        409,
        { code: "GP_RETURNED_MANUAL_REVIEW", needsAdminReview: true },
      );
    }

    const result = await reconcileOutboundAttempt({
      attemptId,
      force: true,
      actorUserId: admin.id,
    });

    await recordAuditEvent({
      protectedTxnId: attempt.protectedTxnId,
      actorUserId: admin.id,
      action: "GP_ADMIN_RECONCILE_ONE",
      meta: { attemptId, result },
    });

    return Response.json({ ok: true, result });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const code = (err as { code?: string }).code;
    const message = err instanceof Error ? err.message : "Failed";
    if (status === 401 || status === 403) {
      return jsonError("Admin required", status);
    }
    if (status >= 400 && status < 500) {
      return jsonError(message, status, code ? { code } : undefined);
    }
    console.error("[admin:gp-reconcile:post]", err);
    return jsonError("GP reconcile failed", 500);
  }
}
