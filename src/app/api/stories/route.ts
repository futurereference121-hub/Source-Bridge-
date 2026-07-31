import { randomBytes } from "crypto";
import { getSessionUser, isAdminUser } from "@/lib/auth";
import {
  StoryUploadError,
  createStoryClip,
  getActiveDurationSeconds,
  listActiveClipsForOwner,
  mapClipPublic,
} from "@/lib/stories";
import {
  MAX_ACTIVE_STORY_SECONDS,
  MAX_STORY_PROXY_BYTES,
  STORY_PRIVACY_NOTICE,
  StoryUploadErrorCode,
  storyErrorMessage,
} from "@/lib/story-constants";
import { isClientBlobUploadConfigured } from "@/lib/storage";
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
        clientUpload: isClientBlobUploadConfigured(),
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
      clientUpload: isClientBlobUploadConfigured(),
    });
  } catch (err) {
    console.error("[stories:GET]", err);
    return jsonError("Failed to load Stories", 500);
  }
}

/**
 * Legacy multipart upload (local/dev or tiny files only).
 * Production clients must use prepare → client-upload → finalize.
 */
export async function POST(req: Request) {
  const requestId = randomBytes(6).toString("hex");
  try {
    const user = await getSessionUser();
    if (!user) {
      return jsonError(
        storyErrorMessage(StoryUploadErrorCode.AUTH_FAILED, requestId),
        401,
        { code: StoryUploadErrorCode.AUTH_FAILED, requestId },
      );
    }
    if (isAdminUser(user)) {
      return jsonError("Administrator accounts cannot post Stories", 403, {
        code: StoryUploadErrorCode.AUTH_FAILED,
        requestId,
      });
    }
    if (!user.emailVerified || !user.onboardingComplete) {
      return jsonError("Complete your profile before posting a Story", 400, {
        code: StoryUploadErrorCode.UNKNOWN,
        requestId,
      });
    }

    // Prefer direct-to-Blob in production — reject fat bodies early with a clear code.
    if (isClientBlobUploadConfigured() && process.env.VERCEL) {
      return jsonError(
        storyErrorMessage(StoryUploadErrorCode.REQUEST_TOO_LARGE, requestId),
        413,
        {
          code: StoryUploadErrorCode.REQUEST_TOO_LARGE,
          requestId,
          useClientUpload: true,
        },
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    const poster = form.get("poster");
    const durationRaw = form.get("durationSec");
    const durationSec = Number(durationRaw);

    if (!(file instanceof File)) {
      return jsonError("file is required", 400, {
        code: StoryUploadErrorCode.UNKNOWN,
        requestId,
      });
    }

    if (file.size > MAX_STORY_PROXY_BYTES) {
      return jsonError(
        storyErrorMessage(StoryUploadErrorCode.REQUEST_TOO_LARGE, requestId),
        413,
        {
          code: StoryUploadErrorCode.REQUEST_TOO_LARGE,
          requestId,
          useClientUpload: true,
        },
      );
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
      requestId,
    });
  } catch (err) {
    if (err instanceof StoryUploadError) {
      return jsonError(err.message, err.status, {
        code: err.code,
        requestId: err.requestId || requestId,
      });
    }
    const status = (err as { status?: number }).status || 500;
    const message =
      err instanceof Error ? err.message : "Could not upload Story";
    if (status >= 400 && status < 500) {
      return jsonError(message, status, {
        code: StoryUploadErrorCode.UNKNOWN,
        requestId,
      });
    }
    console.error("[stories:POST]", requestId, err);
    return jsonError(
      storyErrorMessage(StoryUploadErrorCode.UNKNOWN, requestId),
      500,
      { code: StoryUploadErrorCode.UNKNOWN, requestId },
    );
  }
}
