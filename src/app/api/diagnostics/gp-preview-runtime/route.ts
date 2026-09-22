/**
 * TEMPORARY — Global Payouts Preview runtime diagnostic (GET only).
 * Available only when: VERCEL_ENV=preview, VERCEL_GIT_COMMIT_REF=global-payouts-pilot,
 * GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED=false, and one-time auth header matches.
 * Outside that gate → 404. Remove after one validation + cleanup redeploy.
 */

import {
  GP_PREVIEW_RUNTIME_DIAG_HEADER,
  isGpPreviewRuntimeDiagGateOpen,
  runGpPreviewRuntimeDiag,
  verifyGpPreviewRuntimeDiagAuth,
} from "@/lib/payments/payout-rail/preview-runtime-diag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: Request) {
  const gate = isGpPreviewRuntimeDiagGateOpen();
  if (!gate.open) {
    return new Response(null, { status: 404 });
  }

  const auth = req.headers.get(GP_PREVIEW_RUNTIME_DIAG_HEADER);
  if (!verifyGpPreviewRuntimeDiagAuth(auth)) {
    return new Response(null, { status: 404 });
  }

  try {
    const result = await runGpPreviewRuntimeDiag();
    return Response.json(
      {
        label: "GP_PREVIEW_RUNTIME_DIAG",
        ...result,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    // Never leak secrets in errors
    return Response.json(
      { label: "GP_PREVIEW_RUNTIME_DIAG", ok: false, error: "diag_failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
