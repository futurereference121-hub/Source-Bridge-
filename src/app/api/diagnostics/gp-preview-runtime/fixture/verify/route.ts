/**
 * Read-only Preview verification of the labelled Sandbox payment.
 * GET only. Ignores the body and any caller-supplied IDs.
 */

import {
  GP_PREVIEW_RUNTIME_DIAG_HEADER,
  isGpPreviewRuntimeDiagGateOpen,
  verifyGpPreviewRuntimeDiagAuth,
} from "@/lib/payments/payout-rail/preview-runtime-diag";
import { runSandboxPaymentVerification } from "@/lib/payments/payout-rail/preview-sandbox-verify";

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
    const result = await runSandboxPaymentVerification();
    return Response.json(result, { status: 200, headers: noStore });
  } catch {
    return Response.json(
      {
        label: "GP_SANDBOX_PAYMENT_VERIFICATION",
        ok: false,
        status: "GP_SANDBOX_PAYMENT_VERIFICATION_BLOCKED",
        blocker: "verification_failed",
        mutations: { stripe_writes: 0, db_writes: 0 },
        production_untouched: true,
        connect_untouched: true,
      },
      { status: 500, headers: noStore },
    );
  }
}
