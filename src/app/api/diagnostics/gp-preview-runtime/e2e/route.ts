/**
 * TEMPORARY Preview-only Sandbox E2E release (POST only).
 * Same gate and auth as the runtime diagnostic. Ignores any request body.
 * Outside the gate → 404. Targets only the labelled fixture.
 */

import {
  GP_PREVIEW_RUNTIME_DIAG_HEADER,
  isGpPreviewRuntimeDiagGateOpen,
  verifyGpPreviewRuntimeDiagAuth,
} from "@/lib/payments/payout-rail/preview-runtime-diag";
import { runSandboxE2eRelease } from "@/lib/payments/payout-rail/preview-sandbox-e2e";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
    const result = await runSandboxE2eRelease();
    return Response.json(result, { status: 200, headers: noStore });
  } catch {
    return Response.json(
      {
        ok: false,
        status: "GP_SANDBOX_E2E_BLOCKED",
        blocker: "stripe_creation_uncertain",
        stripe_creation: "uncertain",
        stripe_writes: 0,
        production_untouched: true,
        connect_untouched: true,
        initiation_setting: "false",
      },
      { status: 200, headers: noStore },
    );
  }
}
