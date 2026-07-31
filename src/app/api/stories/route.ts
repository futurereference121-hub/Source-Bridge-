import { getSessionUser, isAdminUser } from "@/lib/auth";
import {
  createStoryClip,
  getActiveDurationSeconds,
  listActiveClipsForOwner,
  mapClipPublic,
} from "@/lib/stories";
import {
  MAX_ACTIVE_STORY_SECONDS,
  STORY_PRIVACY_NOTICE,
} from "@/lib/story-constants";
import { jsonError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET — owner’s active clips + duration allowance. */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return jsonError("Sign in required", 401);
    if (isAdminUser(user)) {
      return Response.json({
        ok: true,
        clips: [],
        activeSeconds: 0,
        maxActiveSeconds: MAX_ACTIVE_STORY_SECONDS,
        privacyNotice: STORY_PRIVACY_NOTICE,
      });
    }
    const [clips, activeSeconds] = await Promise.all([
      listActiveClipsForOwner(user.id),
      getActiveDurationSeconds(user.id),
    ]);
    return Response.json({
      ok: true,
      clips: clips.map((c) => mapClipPublic(c, true)),
      activeSeconds,
      maxActiveSeconds: MAX_ACTIVE_STORY_SECONDS,
      privacyNotice: STORY_PRIVACY_NOTICE,
    });
  } catch (err) {
    console.error("[stories:GET]", err);
    return jsonError("Failed to load Stories", 500);
  }
}

/** POST — upload a new Story clip (multipart). */
export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return jsonError("Sign in required", 401);
    if (isAdminUser(user)) {
      return jsonError("Administrator accounts cannot post Stories", 403);
    }
    if (!user.emailVerified || !user.onboardingComplete) {
      return jsonError("Complete your profile before posting a Story", 400);
    }

    const form = await req.formData();
    const file = form.get("file");
    const poster = form.get("poster");
    const durationRaw = form.get("durationSec");
    const durationSec = Number(durationRaw);

    if (!(file instanceof File)) {
      return jsonError("file is required", 400);
    }

    const clip = await createStoryClip({
      userId: user.id,
      file,
      clientDurationSec: durationSec,
      poster: poster instanceof File ? poster : null,
      username: user.username,
      slug: user.slug,
    });

    return Response.json({
      ok: true,
      clip: mapClipPublic(clip),
      message: "Story added successfully.",
    });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message =
      err instanceof Error ? err.message : "Could not upload Story";
    if (status >= 400 && status < 500) return jsonError(message, status);
    console.error("[stories:POST]", err);
    return jsonError("Could not upload Story. Please try again.", 500);
  }
}
