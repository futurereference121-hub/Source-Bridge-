import { randomBytes } from "crypto";
import { getSessionUser, isAdminUser } from "@/lib/auth";
import {
  MAX_STORY_CLIP_BYTES,
  StoryUploadErrorCode,
  resolveStoryMime,
  storyErrorMessage,
} from "@/lib/story-constants";
import { createMuxDirectUpload, isMuxConfigured } from "@/lib/mux-stories";
import { storyCorsOrigin } from "@/lib/stories";
import {
  blobPathForUser,
  isClientBlobUploadConfigured,
} from "@/lib/storage";
import { jsonError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Issues an upload target before the browser sends any bytes.
 *
 * Primary: a short-lived Mux direct-upload URL — the client PUTs the original
 * straight to Mux and the file never touches a Next.js request body.
 * Fallback: a user-scoped Blob pathname, local development only.
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

    const uploadSessionId = `us_${randomBytes(16).toString("hex")}`;

    if (isMuxConfigured()) {
      const upload = await createMuxDirectUpload({
        uploadSessionId,
        corsOrigin: storyCorsOrigin(req.headers.get("origin")),
      });
      return Response.json({
        ok: true,
        provider: "mux",
        uploadUrl: upload.uploadUrl,
        uploadId: upload.uploadId,
        uploadSessionId,
        contentType: mime,
        maxBytes: MAX_STORY_CLIP_BYTES,
        requestId,
      });
    }

    // Without Mux there is no transcoder — never publish raw originals in prod.
    if (process.env.VERCEL || !isClientBlobUploadConfigured()) {
      return jsonError(
        storyErrorMessage(StoryUploadErrorCode.STORAGE_FAILED, requestId),
        503,
        { code: StoryUploadErrorCode.STORAGE_FAILED, requestId },
      );
    }

    return Response.json({
      ok: true,
      provider: "blob",
      pathname: blobPathForUser(user.id, "stories", mime),
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
