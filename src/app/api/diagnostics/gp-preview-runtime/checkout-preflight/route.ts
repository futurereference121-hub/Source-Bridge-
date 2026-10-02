/**
 * Read-only Preview checkout preflight.
 * GET only. Ignores the body and any caller-supplied IDs.
 */

import {
  GP_PREVIEW_RUNTIME_DIAG_HEADER,
  isGpPreviewRuntimeDiagGateOpen,
  verifyGpPreviewRuntimeDiagAuth,
} from "@/lib/payments/payout-rail/preview-runtime-diag";
import { runCheckoutPreflight } from "@/lib/payments/payout-rail/preview-checkout-preflight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const noStore = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const gate = isGpPreviewRuntimeDiagGateOpen();
  if (!gate.open) return new Response(null, { status: 404 });
  const auth = req.headers.get(GP_PREVIEW_RUNTIME_DIAG_HEADER);
  if (!verifyGpPreviewRuntimeDiagAuth(auth)) {
    return new Response(null, { status: 404 });
  }
  void req;
  try {
    const result = await runCheckoutPreflight();
    return Response.json(result, { status: 200, headers: noStore });
  } catch {
    return Response.json(
      {
        label: "GP_NORMAL_CHECKOUT_PREFLIGHT",
        ok: false,
        blocker: "checkout_preflight_failed",
        mutations: { stripe_writes: 0, db_writes: 0 },
        production_untouched: true,
      },
      { status: 500, headers: noStore },
    );
  }
}
