import { requireAdmin } from "@/lib/auth";
import { runApprovedTestPreflight } from "@/lib/payments/payout-rail/proceeds-preflight";
import { jsonError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only TEST preflight for the approved purchase.
 * Not linked from the admin UI. Do not call this until the funding flag
 * is still off and a deployment review asks for the account reads.
 */
export async function GET() {
  try {
    await requireAdmin();
    return Response.json(await runApprovedTestPreflight());
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number(err.status) : 500;
    if (status === 401) return jsonError("Unauthorized", 401);
    if (status === 403) return jsonError("Admin only", 403);
    console.error("[gp-proceeds-preflight]", err instanceof Error ? err.name : "error");
    return jsonError("Preflight failed", 500);
  }
}
