import { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { issueCaptureThumbnailGrant } from "@/lib/live/watch";
import { jsonError } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Server-authorized Cloudflare Live frame (JPEG). Not a video proxy.
 * Used when canvas capture is CORS-tainted.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSessionUser();
    const { id } = await ctx.params;
    const t = Number(req.nextUrl.searchParams.get("t") || "0");
    const grant = await issueCaptureThumbnailGrant({
      user,
      sessionId: id,
      offsetSeconds: Number.isFinite(t) ? t : 0,
    });

    const cfRes = await fetch(grant.thumbnailUrl, {
      headers: { Accept: "image/jpeg,image/*" },
    });
    if (!cfRes.ok) {
      return jsonError(
        "Cloudflare could not provide this Live frame",
        503,
        { code: "NO_LIVE_FRAME" },
      );
    }
    const buf = await cfRes.arrayBuffer();
    if (buf.byteLength < 32) {
      return jsonError(
        "Cloudflare could not provide this Live frame",
        503,
        { code: "NO_LIVE_FRAME" },
      );
    }
    return new Response(buf, {
      headers: {
        "Content-Type": cfRes.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const code = (err as { code?: string }).code;
    const message = err instanceof Error ? err.message : "Frame capture failed";
    if (status === 401) return jsonError("Sign in required", 401, { code });
    if (status >= 400 && status < 500) return jsonError(message, status, { code });
    console.error("[live:capture-frame]", err);
    return jsonError(message, status, { code: code || "NO_LIVE_FRAME" });
  }
}
