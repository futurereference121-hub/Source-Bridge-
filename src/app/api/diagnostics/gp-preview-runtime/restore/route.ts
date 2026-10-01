/**
 * TEMPORARY Preview-only fixture restore (POST only).
 * Same gate and auth as the runtime diagnostic. Ignores any request body.
 * Outside the gate → 404. Response is never cached.
 */

import {
  GP_PREVIEW_RUNTIME_DIAG_HEADER,
  isGpPreviewRuntimeDiagGateOpen,
  verifyGpPreviewRuntimeDiagAuth,
} from "@/lib/payments/payout-rail/preview-runtime-diag";
import { restorePreviewSandboxFixture } from "@/lib/payments/payout-rail/preview-fixture-restore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const noStore = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  const gate = isGpPreviewRuntimeDiagGateOpen();
  if (!gate.open) return new Response(null, { status: 404 });

  const auth = req.headers.get(GP_PREVIEW_RUNTIME_DIAG_HEADER);
  if (!verifyGpPreviewRuntimeDiagAuth(auth)) {
    return new Response(null, { status: 404 });
  }

  void req;
  try {
    const result = await restorePreviewSandboxFixture();
    return Response.json(
      { label: "GP_PREVIEW_FIXTURE_RESTORE", ...result },
      { status: 200, headers: noStore },
    );
  } catch {
    return Response.json(
      {
        label: "GP_PREVIEW_FIXTURE_RESTORE",
        ok: false,
        error: "restore_failed",
        db_rows_written: 0,
        stripe_writes: 0,
      },
      { status: 500, headers: noStore },
    );
  }
}
