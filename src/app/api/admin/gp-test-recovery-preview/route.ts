import { requireAdmin } from "@/lib/auth";
import { runDamagedTestRecoveryPreview } from "@/lib/payments/payout-rail/test-recovery-run";
import { jsonError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only TEST recovery preview for purchase hash b8444fb7.
 * Does not create a top-up, funding payout, quote, or outbound payment.
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
