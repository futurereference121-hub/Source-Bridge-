import { reconcileOpportunities } from "@/lib/opportunities/reconcile";
import { jsonError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Bounded Opportunity expiry + pre-expiry renew nudges.
 * Protect with CRON_SECRET when set.
 */
export async function POST(req: Request) {
  try {
    const secret = process.env.CRON_SECRET || "";
    if (secret) {
      const auth = req.headers.get("authorization") || "";
      if (auth !== `Bearer ${secret}`) {
        return jsonError("Unauthorized", 401);
      }
    }
    const result = await reconcileOpportunities(100);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("[opportunities:reconcile]", err);
    return jsonError("Opportunity reconciliation failed", 500);
  }
}

export async function GET(req: Request) {
  return POST(req);
}
