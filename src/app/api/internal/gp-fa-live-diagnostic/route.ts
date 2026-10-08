/**
 * Temporary Production read for the configured LIVE financial account.
 * Removed after the one authorized retrieve.
 */

import { NextRequest } from "next/server";
import {
  FA_DIAG_HEADER,
  handleLiveFaDiagnosticRequest,
} from "@/lib/payments/payout-rail/fa-live-diagnostic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const decision = await handleLiveFaDiagnosticRequest({
    searchParams: url.searchParams.entries(),
    contentLength: req.headers.get("content-length"),
    presentedToken: req.headers.get(FA_DIAG_HEADER),
    nowMs: Date.now(),
    env: {
      token: process.env.GP_FA_DIAG_TOKEN,
      expiresAt: process.env.GP_FA_DIAG_EXPIRES_AT,
      sandbox: process.env.GLOBAL_PAYOUTS_SANDBOX_ENABLED,
      liveInitiation: process.env.GLOBAL_PAYOUTS_LIVE_INITIATION_ENABLED,
    },
  });
  return Response.json(decision.body, { status: decision.status, headers: noStore });
}
