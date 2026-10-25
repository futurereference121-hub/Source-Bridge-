import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  abandonDamagedTestFundingRow,
  confirmTestSiblingFundingLeg,
  runDamagedTestRecoveryPreview,
} from "@/lib/payments/payout-rail/test-recovery-run";
import { jsonError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: read-only TEST recovery preview for purchase hash b8444fb7.
 * POST { action: "confirm_sibling_leg", confirmed: true }: persist POSTED only
 * after matchFundingCredit finds the exact ReceivedCredit. No new payout.
 */
export async function GET() {
  try {
    await requireAdmin();
    return Response.json(await runDamagedTestRecoveryPreview());
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number(err.status) : 500;
    if (status === 401) return jsonError("Unauthorized", 401);
    if (status === 403) return jsonError("Admin only", 403);
    if (status === 404) return jsonError("Damaged TEST purchase was not found", 404);
    if (status === 409) return jsonError("LIVE GP initiation must stay off", 409);
    console.error("[gp-test-recovery-preview]", err instanceof Error ? err.name : "error");
    return jsonError("Recovery preview failed", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = (await req.json().catch(() => ({}))) as {
      action?: unknown;
      confirmed?: unknown;
    };
    if (body.action === "confirm_sibling_leg" && body.confirmed === true) {
      return Response.json(await confirmTestSiblingFundingLeg());
    }
    if (body.action === "abandon_damaged_test_funding" && body.confirmed === true) {
      return Response.json(await abandonDamagedTestFundingRow());
    }
    return jsonError("confirmed TEST recovery action required", 400);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number(err.status) : 500;
    if (status === 401) return jsonError("Unauthorized", 401);
    if (status === 403) return jsonError("Admin only", 403);
    if (status === 404) return jsonError("Sibling TEST purchase was not found", 404);
    if (status === 409) return jsonError("LIVE GP initiation must stay off", 409);
    console.error("[gp-test-recovery-preview:post]", err instanceof Error ? err.name : "error");
    return jsonError("Sibling leg confirm failed", 500);
  }
}
