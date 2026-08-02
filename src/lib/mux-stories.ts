/**
 * Mux Video helpers for Source Bridge Stories.
 * Direct upload → async transcode → HLS/MP4 delivery via webhooks.
 */
import Mux from "@mux/mux-node";
import {
  MAX_STORY_CLIP_SECONDS,
  STORY_TTL_MS,
} from "@/lib/story-constants";

export function isMuxConfigured(): boolean {
  return Boolean(
    process.env.MUX_TOKEN_ID?.trim() && process.env.MUX_TOKEN_SECRET?.trim(),
  );
}

let muxClient: Mux | null = null;

export function getMuxClient(): Mux {
  if (!isMuxConfigured()) {
    throw new Error("Mux is not configured");
  }
  if (!muxClient) {
    muxClient = new Mux({
      tokenId: process.env.MUX_TOKEN_ID!,
      tokenSecret: process.env.MUX_TOKEN_SECRET!,
    });
  }
  return muxClient;
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

/**
 * Create a short-lived Mux direct upload. Client PUTs the file to uploadUrl.
 * Passthrough carries our uploadSessionId for webhook correlation.
 */
export async function createMuxDirectUpload(opts: {
  uploadSessionId: string;
  corsOrigin: string;
}): Promise<MuxDirectUploadResult> {
  const mux = getMuxClient();
  const upload = await mux.video.uploads.create({
    cors_origin: opts.corsOrigin,
    timeout: 3600,
    new_asset_settings: {
      playback_policies: ["public"],
      mp4_support: "standard",
      passthrough: opts.uploadSessionId,
      // Portrait-aware ABR up to 1080p; Mux picks ladder from source.
      max_resolution_tier: "1080p",
    },
  });
  if (!upload.id || !upload.url) {
    throw new Error("Mux did not return an upload URL");
  }
  return { uploadId: upload.id, uploadUrl: upload.url };
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
  const secret = process.env.MUX_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new Error("MUX_WEBHOOK_SECRET is not configured");
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
