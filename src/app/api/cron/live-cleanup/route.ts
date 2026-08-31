import { runLiveCleanup } from "@/lib/live/cleanup";
import { jsonError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const secret = process.env.CRON_SECRET || "";
    if (secret) {
      const auth = req.headers.get("authorization") || "";
      if (auth !== `Bearer ${secret}`) {
        return jsonError("Unauthorized", 401);
      }
    }
    const result = await runLiveCleanup();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("[live:cleanup]", err);
    return jsonError("Live cleanup failed", 500);
  }
}

export async function GET(req: Request) {
  return POST(req);
}
