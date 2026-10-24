import { requireAdmin } from "@/lib/auth";
import { runtimeDiagnostic } from "@/lib/payments/runtime-diagnostic";
import { jsonError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Authenticated serving-runtime evidence: process.version and deployment SHA only.
 */
export async function GET() {
  try {
    await requireAdmin();
    return Response.json({ ok: true, ...runtimeDiagnostic() });
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number(err.status) : 500;
    if (status === 401) return jsonError("Unauthorized", 401);
    if (status === 403) return jsonError("Admin only", 403);
    console.error("[runtime-diagnostic]", err instanceof Error ? err.name : "error");
    return jsonError("Runtime diagnostic failed", 500);
  }
}
