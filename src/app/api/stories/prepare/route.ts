import { randomBytes } from "crypto";
import { getSessionUser, isAdminUser } from "@/lib/auth";
import {
  MAX_STORY_CLIP_BYTES,
  StoryUploadErrorCode,
  resolveStoryMime,
  storyErrorMessage,
} from "@/lib/story-constants";
import {
  blobPathForUser,
  isClientBlobUploadConfigured,
} from "@/lib/storage";
import { jsonError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns a user-scoped Blob pathname + upload session id before direct upload.
 */
export async function POST(req: Request) {
  const requestId = randomBytes(6).toString("hex");
  try {
    if (!isClientBlobUploadConfigured()) {
      return jsonError(
        storyErrorMessage(StoryUploadErrorCode.STORAGE_FAILED, requestId),
        503,
        { code: StoryUploadErrorCode.STORAGE_FAILED, requestId },
      );
    }

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

    const body = (await req.json().catch(() => ({}))) as {
      filename?: string;
      contentType?: string;
      size?: number;
    };

    const size = Number(body.size || 0);
    if (size <= 0) {
      return jsonError("Empty file.", 400, {
        code: StoryUploadErrorCode.UNSUPPORTED_FORMAT,
        requestId,
      });
    }
    if (size > MAX_STORY_CLIP_BYTES) {
      return jsonError(
        storyErrorMessage(StoryUploadErrorCode.FILE_TOO_LARGE, requestId),
        400,
        { code: StoryUploadErrorCode.FILE_TOO_LARGE, requestId },
      );
    }

    const mime = resolveStoryMime({
      mime: body.contentType,
      filename: body.filename,
    });
    if (!mime) {
      return jsonError(
        storyErrorMessage(StoryUploadErrorCode.UNSUPPORTED_FORMAT, requestId),
        400,
        { code: StoryUploadErrorCode.UNSUPPORTED_FORMAT, requestId },
      );
    }

    const pathname = blobPathForUser(user.id, "stories", mime);
    const uploadSessionId = `us_${randomBytes(16).toString("hex")}`;

    return Response.json({
      ok: true,
      pathname,
      uploadSessionId,
      contentType: mime,
      maxBytes: MAX_STORY_CLIP_BYTES,
      requestId,
    });
  } catch (err) {
    console.error("[stories:prepare]", requestId, err);
    return jsonError(
      storyErrorMessage(StoryUploadErrorCode.UNKNOWN, requestId),
      500,
      { code: StoryUploadErrorCode.UNKNOWN, requestId },
    );
  }
}
