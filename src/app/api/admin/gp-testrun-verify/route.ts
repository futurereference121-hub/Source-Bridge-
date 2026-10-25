import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  recoverCurrentTestRunOutbound,
  verifyCurrentTestRunFunding,
} from "@/lib/payments/payout-rail/gp-testrun-verify";
import { jsonError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: runtime TEST retrieve of 28ce7ec2 funding payout TaHJ9 + credit JsTou.
 * POST { action: "recover_uncertain", confirmed: true }: attach the original
 * outbound only. Never posts a new idempotency key.
 */
export async function GET() {
  try {
    await requireAdmin();
    return Response.json(await verifyCurrentTestRunFunding());
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number(err.status) : 500;
    if (status === 401) return jsonError("Unauthorized", 401);
    if (status === 403) return jsonError("Admin only", 403);
    if (status === 404) return jsonError("Current TEST purchase was not found", 404);
    if (status === 409) return jsonError("LIVE GP initiation must stay off", 409);
    console.error("[gp-testrun-verify]", err instanceof Error ? err.name : "error");
    return jsonError("TEST run verify failed", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = (await req.json().catch(() => ({}))) as {
      action?: unknown;
      confirmed?: unknown;
    };
    if (body.action === "recover_uncertain" && body.confirmed === true) {
      return Response.json(await recoverCurrentTestRunOutbound());
    }
    return jsonError("confirmed recover_uncertain action required", 400);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number(err.status) : 500;
    if (status === 401) return jsonError("Unauthorized", 401);
    if (status === 403) return jsonError("Admin only", 403);
    if (status === 404) return jsonError("Current TEST purchase was not found", 404);
    if (status === 409) return jsonError("LIVE GP initiation must stay off", 409);
    console.error("[gp-testrun-verify:post]", err instanceof Error ? err.name : "error");
    return jsonError("TEST run recover failed", 500);
  }
}
