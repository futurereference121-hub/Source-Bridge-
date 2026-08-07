import { processInspectionReleases } from "@/lib/payments/release";
import { jsonError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron: complete expired inspection windows and release final transfers.
 * Protect with CRON_SECRET (required — never open anonymously):
 *   Authorization: Bearer $CRON_SECRET
 * Vercel Cron injects this header when CRON_SECRET is set on the project.
 */
function assertCronAuthorized(req: Request): Response | null {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret) {
    return jsonError("Cron not configured", 503);
  }
  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${secret}`) {
    return jsonError("Unauthorized", 401);
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const denied = assertCronAuthorized(req);
    if (denied) return denied;

    const results = await processInspectionReleases(50);
    return Response.json({ ok: true, results });
  } catch (err) {
    console.error("[payments-release]", err);
    return jsonError("Payments release failed", 500);
  }
}

export async function GET(req: Request) {
  return POST(req);
}
