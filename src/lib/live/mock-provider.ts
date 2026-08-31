import type {
  LiveCurrentVideo,
  LivePlaybackDescriptor,
  LivePublishCredentials,
  LiveVideoProvider,
  LiveViewerToken,
} from "./provider";
import { LIVE_INGEST_TIMEOUT_SECONDS } from "./constants";

const mockInputs = new Map<
  string,
  { enabled: boolean; videoId: string; whipUrl: string }
>();

function mockHost() {
  return "https://customer-test.cloudflarestream.com";
}

/**
 * In-memory Cloudflare Stream stand-in for automated tests.
 * Never creates paid Stream resources.
 */
export const mockLiveVideoProvider: LiveVideoProvider = {
  async createLiveInput(opts) {
    const inputId = `mock_input_${opts.sessionId}`;
    const videoId = `mock_video_${opts.sessionId}`;
    mockInputs.set(inputId, {
      enabled: true,
      videoId,
      whipUrl: `${mockHost()}/mock-secret-${opts.sessionId}/webRTC/publish`,
    });
    return { inputId, videoId };
  },

  async getPublishCredentials(inputId) {
    const row = mockInputs.get(inputId);
    if (!row) throw new Error("Live input not found");
    return { whipUrl: row.whipUrl };
  },

  async disableLiveInput(inputId) {
    const row = mockInputs.get(inputId);
    if (row) row.enabled = false;
  },

  async deleteLiveInput(inputId) {
    mockInputs.delete(inputId);
  },

  async getPlaybackDescriptor(inputId, videoId) {
    const host = mockHost();
    const id = videoId || inputId;
    return {
      inputId,
      videoId: videoId || mockInputs.get(inputId)?.videoId || null,
      hlsManifestUrl: `${host}/${id}/manifest/video.m3u8`,
      whepUrl: `${host}/${id}/webRTC/play`,
      thumbnailUrl: `${host}/${id}/thumbnails/thumbnail.jpg`,
      customerCode: "test",
    };
  },

  async createViewerToken(opts) {
    const host = mockHost();
    const sub = opts.videoId || opts.inputId;
    const token = `mock.${sub}.${opts.expUnix}`;
    return {
      token,
      exp: opts.expUnix,
      hlsUrl: `${host}/${token}/manifest/video.m3u8?dvrEnabled=true`,
      whepUrl: `${host}/${token}/webRTC/play`,
      thumbnailUrl: `${host}/${token}/thumbnails/thumbnail.jpg`,
    };
  },

  async getViewerCount() {
    return 0;
  },

  async getCurrentVideo(inputId) {
    const row = mockInputs.get(inputId);
    if (!row || !row.enabled) return null;
    return { videoId: row.videoId, live: true };
  },

  getLiveFrameThumbnailUrl(opts) {
    const host = mockHost();
    const time = Math.max(0, Math.floor(opts.offsetSeconds));
    return `${host}/${opts.token}/thumbnails/thumbnail.jpg?time=${time}s&height=720`;
  },

  async deleteRecording() {
    /* no-op */
  },
};

export function resetMockLiveInputs() {
  mockInputs.clear();
}

void LIVE_INGEST_TIMEOUT_SECONDS;

export function isMockPlaybackUrl(url: string): boolean {
  return url.includes("customer-test.cloudflarestream.com");
}

export type { LivePlaybackDescriptor, LivePublishCredentials, LiveViewerToken, LiveCurrentVideo };
