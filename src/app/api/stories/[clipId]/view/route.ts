import { getSessionUser } from "@/lib/auth";
import { recordStoryView } from "@/lib/stories";
import { jsonError } from "@/lib/validation";

type Params = { params: Promise<{ clipId: string }> };

export async function POST(_req: Request, { params }: Params) {
  try {
    const user = await getSessionUser();
    const { clipId } = await params;
    const result = await recordStoryView({
      clipId,
      viewerUserId: user?.id ?? null,
    });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("[stories:view]", err);
    return jsonError("Could not record view", 500);
  }
}
