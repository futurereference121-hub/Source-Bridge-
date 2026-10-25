import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { executeTestPlatformBalanceRepair } from "@/lib/payments/payout-rail/test-recovery-topup";
import { jsonError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * TEST platform payments-balance top-up for b8444fb7.
 * No buyer PaymentIntent. No FA credit. LIVE GP stays off.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = (await req.json().catch(() => ({}))) as {
      action?: unknown;
      confirmed?: unknown;
    };
    if (body.action !== "restore_platform_balance" || body.confirmed !== true) {
      return jsonError("restore_platform_balance confirmation required", 400);
    }
    return Response.json(await executeTestPlatformBalanceRepair({ confirmed: true }));
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number(err.status) : 500;
    if (status === 401) return jsonError("Unauthorized", 401);
    if (status === 403) return jsonError("Admin only", 403);
    if (status === 404) return jsonError("Damaged TEST purchase was not found", 404);
    if (status === 409) return jsonError("LIVE GP initiation must stay off", 409);
    console.error("[gp-test-recovery-topup]", err instanceof Error ? err.name : "error");
    return jsonError("TEST repair top-up failed", 500);
  }
}
