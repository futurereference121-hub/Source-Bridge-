import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { randomBytes } from "crypto";
import { getSessionUser, isAdminUser } from "@/lib/auth";
import {
  ALLOWED_STORY_VIDEO_TYPES,
  MAX_STORY_CLIP_BYTES,
  StoryUploadErrorCode,
  storyErrorMessage,
} from "@/lib/story-constants";
import {
  getPublicBlobToken,
  isClientBlobUploadConfigured,
  pathnameBelongsToUser,
} from "@/lib/storage";
import { jsonError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Issues short-lived, user-scoped Blob client tokens for Story video uploads.
 * Browser uploads directly to Vercel Blob (avoids the serverless request body limit).
 */
export async function POST(request: Request) {
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

    const body = (await request.json()) as HandleUploadBody;
    const token = getPublicBlobToken();
    if (!token) {
      return jsonError(
        storyErrorMessage(StoryUploadErrorCode.STORAGE_FAILED, requestId),
        503,
        { code: StoryUploadErrorCode.STORAGE_FAILED, requestId },
      );
    }

    const jsonResponse = await handleUpload({
      body,
      request,
      token,
      onBeforeGenerateToken: async (pathname) => {
        const clean = pathname.replace(/^\/+/, "");
        if (
          !pathnameBelongsToUser(clean, user.id) ||
          !clean.startsWith(`stories/${user.id}/`)
        ) {
          throw new Error(
            storyErrorMessage(StoryUploadErrorCode.OWNERSHIP_FAILED, requestId),
          );
        }

        return {
          allowedContentTypes: [...ALLOWED_STORY_VIDEO_TYPES],
          maximumSizeInBytes: MAX_STORY_CLIP_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
          validUntil: Date.now() + 30 * 60 * 1000,
          tokenPayload: JSON.stringify({
            userId: user.id,
            pathname: clean,
            requestId,
          }),
        };
      },
    });

    return Response.json(jsonResponse);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not start Story upload";
    console.error("[stories:client-upload]", requestId, message);
    return jsonError(message, 400, {
      code: StoryUploadErrorCode.STORAGE_FAILED,
      requestId,
    });
  }
}
