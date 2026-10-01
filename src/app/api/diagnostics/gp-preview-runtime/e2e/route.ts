/**
 * Diagnostic Sandbox release and corrected-retry entry point.
 * Permanently disabled: authenticated requests get a refusal and no writes.
 */

import {
  GP_PREVIEW_RUNTIME_DIAG_HEADER,
  isGpPreviewRuntimeDiagGateOpen,
  verifyGpPreviewRuntimeDiagAuth,
} from "@/lib/payments/payout-rail/preview-runtime-diag";
import { disabledDiagnosticMutation } from "@/lib/payments/payout-rail/preview-diagnostic-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const noStore = { "Cache-Control": "no-store" };

export async function POST(req: Request) {
  const gate = isGpPreviewRuntimeDiagGateOpen();
  if (!gate.open) return new Response(null, { status: 404 });
  const auth = req.headers.get(GP_PREVIEW_RUNTIME_DIAG_HEADER);
  if (!verifyGpPreviewRuntimeDiagAuth(auth)) {
    return new Response(null, { status: 404 });
  }
  void req;
  return Response.json(disabledDiagnosticMutation("e2e"), {
    status: 410,
    headers: noStore,
  });
}
