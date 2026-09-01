import { LIVE_INGEST_TIMEOUT_SECONDS } from "./constants";
import type {
  LiveCurrentVideo,
  LivePlaybackDescriptor,
  LivePublishCredentials,
  LiveVideoProvider,
  LiveViewerToken,
} from "./provider";
import { streamSigningKeyId } from "./signing-key";
import {
  signCloudflareStreamToken,
  signedHlsUrl,
  signedThumbnailUrl,
  signedWhepUrl,
  streamCustomerHost,
} from "./signed-token";

const CF_API = "https://api.cloudflare.com/client/v4";

type CfEnvelope<T> = {
  success: boolean;
  errors?: { message?: string; code?: number }[];
  result?: T;
};

type CfLiveInput = {
  uid: string;
  webRTC?: { url?: string };
  webRTCPlayback?: { url?: string };
  playback?: { hls?: string };
};

type CfVideo = {
  uid: string;
  status?: { state?: string };
};

function accountId(): string {
  return (process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
}

function apiToken(): string {
  return (process.env.CLOUDFLARE_API_TOKEN || "").trim();
}

function customerCode(): string {
  return (process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE || "")
    .trim()
    .replace(/^customer-/, "");
}

async function cfFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken()}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as CfEnvelope<T>;
  if (!res.ok || !body.success || body.result === undefined) {
    const msg =
      body.errors?.[0]?.message ||
      `Cloudflare Stream request failed (${res.status})`;
    throw new Error(msg);
  }
  return body.result;
}

function host(): string {
  return streamCustomerHost(customerCode());
}

/**
 * Current Cloudflare Stream Live Inputs API (WHIP publish, HLS + DVR playback).
 * Docs: start-stream-live, webrtc-beta, dvr-for-live, securing-your-stream (2026).
 *
 * WHIP ingest + HLS DVR are documented as a beta pairing ("coming soon" to
 * officially bridge). We still request recording.mode=automatic so HLS/DVR
 * and live-frame thumbnails exist when Stream materializes a live video UID.
 * Playback descriptor always includes WHEP as the WHIP companion.
 */
export const cloudflareLiveVideoProvider: LiveVideoProvider = {
  async createLiveInput(opts) {
    const created = await cfFetch<CfLiveInput>(
      `/accounts/${accountId()}/stream/live_inputs`,
      {
        method: "POST",
        body: JSON.stringify({
          meta: { name: opts.name, sourceBridgeSessionId: opts.sessionId },
          enabled: true,
          preferLowLatency: true,
          deleteRecordingAfterDays: 30,
          recording: {
            mode: "automatic",
            requireSignedURLs: true,
            hideLiveViewerCount: false,
            timeoutSeconds: LIVE_INGEST_TIMEOUT_SECONDS,
          },
        }),
      },
    );
    return { inputId: created.uid, videoId: null };
  },

  async getPublishCredentials(inputId) {
    const input = await cfFetch<CfLiveInput>(
      `/accounts/${accountId()}/stream/live_inputs/${inputId}`,
    );
    const whipUrl = input.webRTC?.url || "";
    if (!whipUrl) {
      throw new Error("Cloudflare Live Input is missing WHIP publish URL");
    }
    return { whipUrl };
  },

  async disableLiveInput(inputId) {
    await cfFetch(`/accounts/${accountId()}/stream/live_inputs/${inputId}`, {
      method: "PUT",
      body: JSON.stringify({ enabled: false }),
    });
  },

  async deleteLiveInput(inputId) {
    const res = await fetch(
      `${CF_API}/accounts/${accountId()}/stream/live_inputs/${inputId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiToken()}` },
      },
    );
    if (!res.ok && res.status !== 404) {
      const body = (await res.json().catch(() => ({}))) as CfEnvelope<unknown>;
      throw new Error(
        body.errors?.[0]?.message || `Failed to delete live input (${res.status})`,
      );
    }
  },

  async getPlaybackDescriptor(inputId, videoId) {
    const h = host();
    const playId = videoId || inputId;
    return {
      inputId,
      videoId: videoId || null,
      hlsManifestUrl: `${h}/${playId}/manifest/video.m3u8`,
      whepUrl: `${h}/${inputId}/webRTC/play`,
      thumbnailUrl: `${h}/${playId}/thumbnails/thumbnail.jpg`,
      customerCode: customerCode(),
    };
  },

  async createViewerToken(opts) {
    const kid = streamSigningKeyId();
    const sub = opts.videoId || opts.inputId;
    const token = signCloudflareStreamToken({
      sub,
      kid,
      expUnix: opts.expUnix,
      nbfUnix: opts.nbfUnix,
    });
    const h = host();
    return {
      token,
      exp: opts.expUnix,
      hlsUrl: signedHlsUrl(h, token),
      whepUrl: signedWhepUrl(h, token),
      thumbnailUrl: `${h}/${token}/thumbnails/thumbnail.jpg`,
    };
  },

  async getViewerCount(inputId, videoId) {
    try {
      const id = videoId || inputId;
      const res = await fetch(`${host()}/${id}/lifecycle`);
      if (!res.ok) return null;
      const body = (await res.json()) as { live?: boolean; videoUID?: string };
      if (!body.live) return 0;
      return null;
    } catch {
      return null;
    }
  },

  async getCurrentVideo(inputId): Promise<LiveCurrentVideo | null> {
    try {
      const res = await fetch(`${host()}/${inputId}/lifecycle`);
      if (!res.ok) return null;
      const body = (await res.json()) as {
        live?: boolean;
        videoUID?: string | null;
      };
      if (!body.videoUID) return null;
      return { videoId: body.videoUID, live: Boolean(body.live) };
    } catch {
      return null;
    }
  },

  getLiveFrameThumbnailUrl(opts) {
    return signedThumbnailUrl(host(), opts.token, opts.offsetSeconds);
  },

  async deleteRecording(videoId) {
    const res = await fetch(
      `${CF_API}/accounts/${accountId()}/stream/${videoId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${apiToken()}` },
      },
    );
    if (!res.ok && res.status !== 404) {
      throw new Error(`Failed to delete Stream recording (${res.status})`);
    }
  },
};

void LIVE_INGEST_TIMEOUT_SECONDS;

export type { LivePlaybackDescriptor, LivePublishCredentials, LiveViewerToken };
