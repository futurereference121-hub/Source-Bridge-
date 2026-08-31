import { NextRequest } from "next/server";
import { requireSessionUser } from "@/lib/auth";
import { listDiscoverableLive } from "@/lib/live/discovery";
import { LIVE_START_UNAVAILABLE_MESSAGE } from "@/lib/live/constants";
import { prepareLiveSession } from "@/lib/live/sessions";
import { jsonError } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const limit = Number(req.nextUrl.searchParams.get("limit") || "24");
    const cursor = req.nextUrl.searchParams.get("cursor");
    const result = await listDiscoverableLive({
      limit: Number.isFinite(limit) ? limit : 24,
      cursor,
    });
    return Response.json(result, {
      headers: { "Cache-Control": "public, max-age=5, stale-while-revalidate=15" },
    });
  } catch (err) {
    console.error("[live:discover]", err);
    return jsonError("Could not load Live", 500);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireSessionUser();
    const body = (await req.json().catch(() => ({}))) as {
      title?: string;
      locationLabel?: string;
    };
    const result = await prepareLiveSession({
      user,
      title: body.title || "",
      locationLabel: body.locationLabel || "",
    });
    return Response.json({ ok: true, ...result }, { status: 201 });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const code = (err as { code?: string }).code;
    const message = err instanceof Error ? err.message : "Could not start Live";
    if (status === 401) return jsonError("Sign in required", 401, { code });
    if (status >= 400 && status < 500) return jsonError(message, status, { code });
    console.error("[live:start]", err);
    return jsonError(
      LIVE_START_UNAVAILABLE_MESSAGE,
      status >= 500 ? 503 : 500,
      { code: code || "PROVIDER_UNAVAILABLE" },
    );
  }
}
