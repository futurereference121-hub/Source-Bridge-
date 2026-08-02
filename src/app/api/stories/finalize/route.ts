import { randomBytes } from "crypto";
import { getSessionUser, isAdminUser } from "@/lib/auth";
import {
  StoryUploadError,
  finalizeStoryFromBlob,
  finalizeStoryFromMux,
  mapClipPublic,
} from "@/lib/stories";
import {
  StoryUploadErrorCode,
  storyErrorMessage,
} from "@/lib/story-constants";
import { jsonError } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Finalises a direct upload into a StoryClip record.
 *
 * Mux payloads create a PROCESSING clip — it is NOT public until the
 * `video.asset.ready` webhook lands. Legacy Blob payloads still publish
 * immediately. Video bytes never arrive here; only metadata and a poster image.
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

    const contentType = req.headers.get("content-type") || "";
    let pathname = "";
    let url = "";
    let mime = "";
    let size = 0;
    let durationSec: number | null = null;
    let uploadSessionId = "";
    let muxUploadId = "";
    let originalFilename = "";
    let poster: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      pathname = String(form.get("pathname") || "");
      url = String(form.get("url") || "");
      mime = String(form.get("contentType") || "");
      size = Number(form.get("size") || 0);
      const durRaw = form.get("durationSec");
      durationSec =
        durRaw === null || durRaw === "" ? null : Number(durRaw);
      uploadSessionId = String(form.get("uploadSessionId") || "");
      muxUploadId = String(form.get("muxUploadId") || "");
      originalFilename = String(form.get("originalFilename") || "");
      const p = form.get("poster");
      poster = p instanceof File ? p : null;
    } else {
      const body = (await req.json()) as {
        pathname?: string;
        url?: string;
        contentType?: string;
        size?: number;
        durationSec?: number | null;
        uploadSessionId?: string;
        muxUploadId?: string;
        originalFilename?: string;
      };
      pathname = body.pathname || "";
      url = body.url || "";
      mime = body.contentType || "";
      size = Number(body.size || 0);
      durationSec =
        body.durationSec === undefined || body.durationSec === null
          ? null
          : Number(body.durationSec);
      uploadSessionId = body.uploadSessionId || "";
      muxUploadId = body.muxUploadId || "";
      originalFilename = body.originalFilename || "";
    }

    if (!uploadSessionId) {
      return jsonError("Incomplete upload finalisation payload.", 400, {
        code: StoryUploadErrorCode.UNKNOWN,
        requestId,
      });
    }

    if (muxUploadId) {
      const clip = await finalizeStoryFromMux({
        userId: user.id,
        uploadSessionId,
        muxUploadId,
        size,
        contentType: mime,
        clientDurationSec: durationSec,
        originalFilename,
        poster,
      });

      return Response.json({
        ok: true,
        provider: "mux",
        processing: true,
        clip: mapClipPublic(clip, false, true),
        message:
          "Your Story is processing. We’ll publish it as soon as it’s ready.",
        requestId,
      });
    }

    if (!pathname || !url) {
      return jsonError("Incomplete upload finalisation payload.", 400, {
        code: StoryUploadErrorCode.UNKNOWN,
        requestId,
      });
    }

    const clip = await finalizeStoryFromBlob({
      userId: user.id,
      pathname,
      url,
      contentType: mime,
      size,
      clientDurationSec: durationSec,
      uploadSessionId,
      originalFilename,
      poster,
      username: user.username,
      slug: user.slug,
    });

    return Response.json({
      ok: true,
      provider: "blob",
      processing: false,
      clip: mapClipPublic(clip),
      message: "Story added successfully.",
      requestId,
    });
  } catch (err) {
    if (err instanceof StoryUploadError) {
      console.error("[stories:finalize]", err.requestId, err.code, err.message);
      return jsonError(err.message, err.status, {
        code: err.code,
        requestId: err.requestId || requestId,
      });
    }
    console.error("[stories:finalize]", requestId, err);
    return jsonError(
      storyErrorMessage(StoryUploadErrorCode.UNKNOWN, requestId),
      500,
      { code: StoryUploadErrorCode.UNKNOWN, requestId },
    );
  }
}
