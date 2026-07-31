import { getSessionUser } from "@/lib/auth";
import { deleteStoryClip } from "@/lib/stories";
import { jsonError } from "@/lib/validation";

type Params = { params: Promise<{ clipId: string }> };

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const user = await getSessionUser();
    if (!user) return jsonError("Sign in required", 401);
    const { clipId } = await params;
    await deleteStoryClip({
      clipId,
      userId: user.id,
      username: user.username,
      slug: user.slug,
    });
    return Response.json({ ok: true, message: "Story deleted." });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message =
      err instanceof Error ? err.message : "Could not delete Story";
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[stories:DELETE]", err);
    return jsonError("Could not delete Story", 500);
  }
}
