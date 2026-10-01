/**
 * Read-only Preview fixture status. No Stripe calls and no database writes.
 * Same gate as the other Preview diagnostics. Ignores the request body.
 */

import { prisma } from "@/lib/db";
import { discoveryHash8 } from "@/lib/payments/payout-rail/preview-sandbox-discovery";
import {
  GP_PREVIEW_RUNTIME_DIAG_HEADER,
  isGpPreviewRuntimeDiagGateOpen,
  verifyGpPreviewRuntimeDiagAuth,
} from "@/lib/payments/payout-rail/preview-runtime-diag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const FIXTURE_TITLE = "GP_SANDBOX_E2E_FIXTURE_v1";
const noStore = { "Cache-Control": "no-store" };

function previewHostH8(): string | null {
  const raw = String(process.env.DATABASE_URL || "").trim();
  if (!raw) return null;
  try {
    const host = new URL(raw.replace(/^postgresql:/, "postgres:")).hostname;
    return discoveryHash8(host);
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const gate = isGpPreviewRuntimeDiagGateOpen();
  if (!gate.open) return new Response(null, { status: 404 });
  const auth = req.headers.get(GP_PREVIEW_RUNTIME_DIAG_HEADER);
  if (!verifyGpPreviewRuntimeDiagAuth(auth)) {
    return new Response(null, { status: 404 });
  }
  void req;

  const initiation = String(process.env.GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED || "")
    .trim()
    .toLowerCase();
  try {
    const fixtures = await prisma.protectedTransaction.findMany({
      where: { title: FIXTURE_TITLE },
      select: { id: true, status: true, stripeMode: true },
    });
    const txn = fixtures.length === 1 ? fixtures[0] : null;
    const attempts = txn
      ? await prisma.outboundPaymentAttempt.findMany({
          where: { protectedTxnId: txn.id },
          select: {
            id: true,
            status: true,
            stripeOutboundPaymentId: true,
            idempotencyKey: true,
          },
        })
      : [];
    return Response.json(
      {
        label: "GP_SANDBOX_FIXTURE_STATUS",
        ok: fixtures.length === 1,
        host_h8: previewHostH8(),
        deployment_commit: String(process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 12),
        initiation_is_false: initiation === "false" || initiation === "0",
        fixture_count: fixtures.length,
        fixture_txn_h8: txn ? discoveryHash8(txn.id) : null,
        txn_status: txn?.status ?? null,
        stripe_mode: txn?.stripeMode ?? null,
        attempt_count: attempts.length,
        attempts: attempts.map((row) => ({
          attempt_h8: discoveryHash8(row.id),
          status: row.status,
          outbound_present: Boolean(row.stripeOutboundPaymentId),
          corrected_retry: row.idempotencyKey.endsWith("_quote_v1"),
        })),
        mutations: { stripe_writes: 0, db_writes: 0 },
      },
      { status: 200, headers: noStore },
    );
  } catch {
    return Response.json(
      {
        label: "GP_SANDBOX_FIXTURE_STATUS",
        ok: false,
        error: "fixture_status_failed",
        mutations: { stripe_writes: 0, db_writes: 0 },
      },
      { status: 500, headers: noStore },
    );
  }
}
