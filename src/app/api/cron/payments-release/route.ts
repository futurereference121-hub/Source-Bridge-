import { processInspectionReleases } from "@/lib/payments/release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Cron: complete inspection windows and release final transfers.
 * Protect with CRON_SECRET header (Vercel cron).
 */
export async function GET(req: Request) {
  const secret = (process.env.CRON_SECRET || "").trim();
  const auth = req.headers.get("authorization") || "";
  if (secret && auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const results = await processInspectionReleases(50);
  return Response.json({ ok: true, results });
}
