import { getSessionUser, isAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  listActiveClipsForUser,
  mapClipPublic,
} from "@/lib/stories";
import { jsonError } from "@/lib/validation";
import { memberPhoto } from "@/lib/placeholders";

type Params = { params: Promise<{ userId: string }> };

/** GET — active Story timeline for a user (opens viewer). */
export async function GET(_req: Request, { params }: Params) {
  try {
    const viewer = await getSessionUser();
    const { userId } = await params;
    if (!userId) return jsonError("User required", 400);

    const owner = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        username: true,
        slug: true,
        photo: true,
        deletedAt: true,
        isAdmin: true,
        role: true,
        isDemo: true,
      },
    });
    if (!owner || owner.deletedAt) {
      return jsonError("Story not found", 404);
    }
    if (isAdminUser(owner)) {
      return jsonError("Story not found", 404);
    }

    const clips = await listActiveClipsForUser(userId);
    if (!clips.length) {
      return jsonError("No active Story", 404);
    }

    let viewedIds = new Set<string>();
    if (viewer?.id) {
      const views = await prisma.storyView.findMany({
        where: {
          viewerUserId: viewer.id,
          storyClipId: { in: clips.map((c) => c.id) },
        },
        select: { storyClipId: true },
      });
      viewedIds = new Set(views.map((v) => v.storyClipId));
    }

    return Response.json({
      ok: true,
      user: {
        id: owner.id,
        name: owner.name,
        username: owner.username,
        slug: owner.slug,
        photo: memberPhoto(owner.photo),
        isDemo: owner.isDemo,
      },
      clips: clips.map((c) => ({
        ...mapClipPublic(c),
        viewed: viewedIds.has(c.id),
      })),
      isOwner: viewer?.id === owner.id,
    });
  } catch (err) {
    console.error("[stories:user GET]", err);
    return jsonError("Failed to load Story", 500);
  }
}
