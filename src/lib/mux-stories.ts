/**
 * Mux Video helpers for Source Bridge Stories.
 * Direct upload → async transcode → HLS/MP4 delivery via webhooks.
 */
import Mux from "@mux/mux-node";
import { APIError } from "@mux/mux-node/error";
import {
  MAX_STORY_CLIP_SECONDS,
  STORY_TTL_MS,
  StoryUploadErrorCode,
  type StoryUploadErrorCode as StoryErrorCode,
} from "@/lib/story-constants";

export function isMuxConfigured(): boolean {
  return Boolean(
    process.env.MUX_TOKEN_ID?.trim() && process.env.MUX_TOKEN_SECRET?.trim(),
  );
}

let muxClient: Mux | null = null;

function muxCredentials() {
  return {
    tokenId: (process.env.MUX_TOKEN_ID || "").trim(),
    tokenSecret: (process.env.MUX_TOKEN_SECRET || "").trim(),
  };
}

export function getMuxClient(): Mux {
  const { tokenId, tokenSecret } = muxCredentials();
  if (!tokenId || !tokenSecret) {
    throw Object.assign(new Error("Mux is not configured"), {
      code: StoryUploadErrorCode.MUX_NOT_CONFIGURED,
      status: 503,
    });
  }
  if (!muxClient) {
    muxClient = new Mux({ tokenId, tokenSecret });
  }
  return muxClient;
}

/** Reset cached client after env changes (tests / diagnostics). */
export function resetMuxClientForTests() {
  muxClient = null;
}

export function muxHlsUrl(playbackId: string): string {
  return `https://stream.mux.com/${playbackId}.m3u8`;
}

export function muxMp4Url(playbackId: string): string {
  return `https://stream.mux.com/${playbackId}/highest.mp4`;
}

export function muxThumbnailUrl(playbackId: string): string {
  return `https://image.mux.com/${playbackId}/thumbnail.jpg?time=0.5&width=720`;
}

export type MuxDirectUploadResult = {
  uploadId: string;
  uploadUrl: string;
};

export type ClassifiedMuxError = {
  code: StoryErrorCode;
  status: number;
  /** Safe log message — never includes secrets or full request bodies. */
  logMessage: string;
};

/**
 * Map Mux SDK / HTTP failures to Story upload codes.
 * Never returns STORY_UNKNOWN for recognised Mux auth/permission/API failures.
 */
export function classifyMuxError(err: unknown): ClassifiedMuxError {
  if (err && typeof err === "object" && "code" in err) {
    const code = String((err as { code?: string }).code || "");
    if (code === StoryUploadErrorCode.MUX_NOT_CONFIGURED) {
      return {
        code: StoryUploadErrorCode.MUX_NOT_CONFIGURED,
        status: 503,
        logMessage: "Mux env missing",
      };
    }
  }

  if (err instanceof APIError) {
    const status = err.status ?? 500;
    const type =
      (err.error as { error?: { type?: string }; type?: string } | undefined)
        ?.error?.type ||
      (err.error as { type?: string } | undefined)?.type ||
      "";
    const messages =
      (err.error as { error?: { messages?: string[] }; messages?: string[] })
        ?.error?.messages ||
      (err.error as { messages?: string[] } | undefined)?.messages ||
      [];
    const detail = messages[0] || err.message || type || `HTTP ${status}`;

    if (status === 401 || type === "unauthorized") {
      return {
        code: StoryUploadErrorCode.MUX_AUTH_FAILED,
        status: 502,
        logMessage: `Mux auth failed: ${detail}`,
      };
    }
    if (status === 403 || type === "forbidden") {
      return {
        code: StoryUploadErrorCode.MUX_PERMISSION_DENIED,
        status: 502,
        logMessage: `Mux permission denied: ${detail}`,
      };
    }
    if (status === 400 || status === 422) {
      return {
        code: StoryUploadErrorCode.MUX_DIRECT_UPLOAD_FAILED,
        status: 502,
        logMessage: `Mux rejected upload create: ${detail}`,
      };
    }
    return {
      code: StoryUploadErrorCode.MUX_DIRECT_UPLOAD_FAILED,
      status: 502,
      logMessage: `Mux API error ${status}: ${detail}`,
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  if (/not configured/i.test(message)) {
    return {
      code: StoryUploadErrorCode.MUX_NOT_CONFIGURED,
      status: 503,
      logMessage: message,
    };
  }
  return {
    code: StoryUploadErrorCode.MUX_DIRECT_UPLOAD_FAILED,
    status: 502,
    logMessage: message.slice(0, 240),
  };
}

/**
 * Create a short-lived Mux direct upload. Client PUTs the file to uploadUrl.
 * Passthrough carries our uploadSessionId for webhook correlation.
 *
 * Payload matches Mux’s current Direct Upload guide (playback_policies +
 * video_quality + passthrough). CORS allows both apex and www origins by
 * preferring the browser Origin header, then APP_URL, then "*".
 */
export async function createMuxDirectUpload(opts: {
  uploadSessionId: string;
  corsOrigin: string;
}): Promise<MuxDirectUploadResult> {
  const mux = getMuxClient();
  const corsOrigin = opts.corsOrigin.trim() || "*";

  try {
    const upload = await mux.video.uploads.create({
      cors_origin: corsOrigin,
      timeout: 3600,
      new_asset_settings: {
        playback_policies: ["public"],
        passthrough: opts.uploadSessionId,
        // Basic quality is available on standard Mux plans and produces HLS.
        video_quality: "basic",
        // Progressive MP4 fallback for browsers without HLS.
        mp4_support: "capped-1080p",
        max_resolution_tier: "1080p",
      },
    });
    if (!upload.id || !upload.url) {
      throw Object.assign(new Error("Mux did not return an upload URL"), {
        code: StoryUploadErrorCode.MUX_DIRECT_UPLOAD_FAILED,
        status: 502,
      });
    }
    return { uploadId: upload.id, uploadUrl: upload.url };
  } catch (firstErr) {
    // Some accounts reject mp4_support / max_resolution_tier — retry minimal.
    const classified = classifyMuxError(firstErr);
    if (
      classified.code === StoryUploadErrorCode.MUX_AUTH_FAILED ||
      classified.code === StoryUploadErrorCode.MUX_PERMISSION_DENIED ||
      classified.code === StoryUploadErrorCode.MUX_NOT_CONFIGURED
    ) {
      throw Object.assign(new Error(classified.logMessage), {
        code: classified.code,
        status: classified.status,
      });
    }

    try {
      const upload = await mux.video.uploads.create({
        cors_origin: corsOrigin,
        timeout: 3600,
        new_asset_settings: {
          playback_policies: ["public"],
          passthrough: opts.uploadSessionId,
          video_quality: "basic",
        },
      });
      if (!upload.id || !upload.url) {
        throw Object.assign(new Error("Mux did not return an upload URL"), {
          code: StoryUploadErrorCode.MUX_DIRECT_UPLOAD_FAILED,
          status: 502,
        });
      }
      return { uploadId: upload.id, uploadUrl: upload.url };
    } catch (secondErr) {
      const again = classifyMuxError(secondErr);
      throw Object.assign(new Error(again.logMessage), {
        code: again.code,
        status: again.status,
      });
    }
  }
}

export async function deleteMuxAsset(assetId: string | null | undefined) {
  if (!assetId || !isMuxConfigured()) return;
  try {
    const mux = getMuxClient();
    await mux.video.assets.delete(assetId);
  } catch (err) {
    console.error("[mux] delete asset failed", assetId, err);
  }
}

export function isMuxWebhookConfigured(): boolean {
  return Boolean(process.env.MUX_WEBHOOK_SECRET?.trim());
}

/**
 * Throws unless the raw body carries a valid Mux signature.
 * Callers must pass the untouched request body — never a re-serialised object.
 */
export async function verifyMuxWebhook(
  rawBody: string,
  headers: Headers,
): Promise<void> {
  const secret = (process.env.MUX_WEBHOOK_SECRET || "").trim();
  if (!secret) {
    throw Object.assign(new Error("MUX_WEBHOOK_SECRET is not configured"), {
      code: StoryUploadErrorCode.MUX_NOT_CONFIGURED,
      status: 503,
    });
  }
  const mux = getMuxClient();
  await mux.webhooks.verifySignature(rawBody, headers, secret);
}

export function storyExpiresAtFromReady(readyAt = new Date()): Date {
  return new Date(readyAt.getTime() + STORY_TTL_MS);
}

export function durationWithinStoryLimit(durationSec: number): boolean {
  return (
    Number.isFinite(durationSec) &&
    durationSec > 0 &&
    durationSec <= MAX_STORY_CLIP_SECONDS + 0.75
  );
}
