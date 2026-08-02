import { getClipPlaybackGrant } from "@/lib/stories";
import {
  StoryPlaybackErrorCode,
  storyPlaybackErrorMessage,
} from "@/lib/story-constants";
import { jsonError } from "@/lib/validation";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ clipId: string }> };

/**
 * Issues a short-lived authorised playback grant for a READY Story clip.
 * Bytes stream directly from the Mux CDN (or the legacy Blob/CDN for pre-Mux
 * clips) — this route never proxies video bodies.
 */
export async function GET(_req: Request, { params }: Params) {
  try {
    const { clipId } = await params;
    if (!clipId) {
      return jsonError(
        storyPlaybackErrorMessage(StoryPlaybackErrorCode.MEDIA_NOT_FOUND),
        404,
        { code: StoryPlaybackErrorCode.MEDIA_NOT_FOUND },
      );
    }

    const grant = await getClipPlaybackGrant(clipId);
    if (!grant) {
      return jsonError(
        storyPlaybackErrorMessage(StoryPlaybackErrorCode.MEDIA_NOT_FOUND),
        404,
        { code: StoryPlaybackErrorCode.MEDIA_NOT_FOUND },
      );
    }

    return Response.json(
      {
        ok: true,
        clipId: grant.clipId,
        playbackUrl: grant.playbackUrl,
        hlsUrl: grant.hlsUrl,
        mp4Url: grant.mp4Url,
        contentType: grant.contentType,
        expiresAt: grant.expiresAt,
        storyExpiresAt: grant.storyExpiresAt,
        delivery: grant.delivery,
      },
      {
        headers: {
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (err) {
    console.error("[stories:playback]", err);
    return jsonError(
      storyPlaybackErrorMessage(StoryPlaybackErrorCode.STREAM_FAILED),
      500,
      { code: StoryPlaybackErrorCode.STREAM_FAILED },
    );
  }
}
