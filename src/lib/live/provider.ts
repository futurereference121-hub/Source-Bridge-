export type LivePublishCredentials = {
  whipUrl: string;
};

export type LivePlaybackDescriptor = {
  inputId: string;
  videoId: string | null;
  hlsManifestUrl: string;
  whepUrl: string | null;
  thumbnailUrl: string;
  customerCode: string;
};

export type LiveViewerToken = {
  token: string;
  exp: number;
  hlsUrl: string;
  whepUrl: string | null;
  thumbnailUrl: string;
};

export type LiveCurrentVideo = {
  videoId: string;
  live: boolean;
};

/**
 * Cloudflare Stream abstraction. Video bytes never transit Vercel.
 * Mocks are used in automated tests — no paid Stream resources.
 */
export interface LiveVideoProvider {
  createLiveInput(opts: {
    name: string;
    sessionId: string;
  }): Promise<{ inputId: string; videoId?: string | null }>;
  getPublishCredentials(inputId: string): Promise<LivePublishCredentials>;
  disableLiveInput(inputId: string): Promise<void>;
  deleteLiveInput(inputId: string): Promise<void>;
  getPlaybackDescriptor(inputId: string, videoId?: string | null): Promise<LivePlaybackDescriptor>;
  createViewerToken(opts: {
    inputId: string;
    videoId?: string | null;
    expUnix: number;
    nbfUnix?: number;
  }): Promise<LiveViewerToken>;
  getViewerCount(inputId: string, videoId?: string | null): Promise<number | null>;
  getCurrentVideo(inputId: string): Promise<LiveCurrentVideo | null>;
  getLiveFrameThumbnailUrl(opts: {
    inputId: string;
    videoId?: string | null;
    offsetSeconds: number;
    token: string;
  }): string;
  deleteRecording(videoId: string): Promise<void>;
}
