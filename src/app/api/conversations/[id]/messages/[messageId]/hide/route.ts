import { z } from "zod";
import { requireSessionUser } from "@/lib/auth";
import { requireParticipant } from "@/lib/messaging";
import { hideMessageForUser } from "@/lib/conversation-hide";
import { jsonError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; messageId: string }> };

const bodySchema = z.object({
  hidden: z.literal(true),
});

/** Per-user Delete for me — does not erase the other participant's copy. */
export async function POST(req: Request, { params }: Params) {
  try {
    const user = await requireSessionUser();
    const { id, messageId } = await params;
    await requireParticipant(id, user.id);

    const body = await req.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return jsonError("Send { hidden: true } to delete for you", 400);
    }

    await hideMessageForUser({
      conversationId: id,
      messageId,
      userId: user.id,
    });

    return Response.json({ ok: true, hidden: true, messageId });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const code = (err as { code?: string }).code;
    const message = err instanceof Error ? err.message : "Failed";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status >= 400 && status < 500) {
      return jsonError(message, status, code ? { code } : undefined);
    }
    console.error("[messages:hide]", err);
    return jsonError("Failed to hide message", status);
  }
}
