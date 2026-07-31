import { expireStoryClips } from "@/lib/stories";
import { jsonError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Expire Story clips and delete Blob assets.
 * Protect with CRON_SECRET when called remotely:
 *   Authorization: Bearer $CRON_SECRET
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
    const result = await expireStoryClips(200);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("[stories:expire]", err);
    return jsonError("Expiry cleanup failed", 500);
  }
}

export async function GET(req: Request) {
  return POST(req);
}
