import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { activeStoryWhere } from "@/lib/stories";
import { STORY_REPORT_REASONS } from "@/lib/story-constants";
import { jsonError } from "@/lib/validation";

type Params = { params: Promise<{ clipId: string }> };

export async function POST(req: Request, { params }: Params) {
  try {
    const user = await getSessionUser();
    if (!user) return jsonError("Sign in required", 401);
    const { clipId } = await params;
    const body = await req.json().catch(() => ({}));
    const reason =
      typeof body.reason === "string" ? body.reason.trim() : "";
    const notes =
      typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : "";

    if (!STORY_REPORT_REASONS.includes(reason as (typeof STORY_REPORT_REASONS)[number])) {
      return jsonError("Choose a valid report reason", 400);
    }

    const clip = await prisma.storyClip.findFirst({
      where: { id: clipId, ...activeStoryWhere() },
      select: { id: true, userId: true },
    });
    if (!clip) return jsonError("Story not found", 404);
    if (clip.userId === user.id) {
      return jsonError("You cannot report your own Story", 400);
    }

    await prisma.storyReport.upsert({
      where: {
        storyClipId_reporterUserId: {
          storyClipId: clip.id,
          reporterUserId: user.id,
        },
      },
      create: {
        storyClipId: clip.id,
        reporterUserId: user.id,
        reason,
        notes,
      },
      update: { reason, notes, status: "OPEN" },
    });

    return Response.json({
      ok: true,
      message: "Report submitted. Thank you.",
    });
  } catch (err) {
    console.error("[stories:report]", err);
    return jsonError("Could not submit report", 500);
  }
}
