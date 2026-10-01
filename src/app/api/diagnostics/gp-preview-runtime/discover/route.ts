/**
 * TEMPORARY Preview-only Sandbox fixture discovery (GET only).
 * Same gate and auth as the runtime diagnostic. No caller-supplied Stripe ids.
 * Outside the gate → 404. Response is never cached.
 */

import {
  GP_PREVIEW_RUNTIME_DIAG_HEADER,
  isGpPreviewRuntimeDiagGateOpen,
  verifyGpPreviewRuntimeDiagAuth,
} from "@/lib/payments/payout-rail/preview-runtime-diag";
import { runGpSandboxObjectDiscovery } from "@/lib/payments/payout-rail/preview-sandbox-discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const noStore = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const gate = isGpPreviewRuntimeDiagGateOpen();
  if (!gate.open) return new Response(null, { status: 404 });

  const auth = req.headers.get(GP_PREVIEW_RUNTIME_DIAG_HEADER);
  if (!verifyGpPreviewRuntimeDiagAuth(auth)) {
    return new Response(null, { status: 404 });
  }

  try {
    const result = await runGpSandboxObjectDiscovery();
    return Response.json(
      { label: "GP_SANDBOX_OBJECT_DISCOVERY", ...result },
      { status: 200, headers: noStore },
    );
  } catch {
    return Response.json(
      {
        label: "GP_SANDBOX_OBJECT_DISCOVERY",
        ok: false,
        error: "discovery_failed",
        mutations: { stripe_writes: 0, db_writes: 0 },
      },
      { status: 500, headers: noStore },
    );
  }
}
