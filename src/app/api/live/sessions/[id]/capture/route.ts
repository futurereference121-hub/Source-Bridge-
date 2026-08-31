import { requireSessionUser } from "@/lib/auth";
import { prepareLiveCaptureMessage } from "@/lib/live/capture";
import { jsonError } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSessionUser();
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      imageUrl?: string;
      viewedOffsetSeconds?: number;
    };
    if (!body.imageUrl) return jsonError("imageUrl required", 400);
    const result = await prepareLiveCaptureMessage({
      user,
      sessionId: id,
      imageUrl: body.imageUrl,
      viewedOffsetSeconds: body.viewedOffsetSeconds,
    });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const code = (err as { code?: string }).code;
    const message = err instanceof Error ? err.message : "Capture failed";
    if (status === 401) return jsonError("Sign in required", 401, { code });
    if (status >= 400 && status < 500) return jsonError(message, status, { code });
    console.error("[live:capture]", err);
    return jsonError(message, 500, { code });
  }
}
