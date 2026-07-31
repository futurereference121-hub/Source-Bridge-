/** Profile video limits — client and server. */

export const MAX_PROFILE_VIDEO_SECONDS = 90;
/** ~80 MB — enough for a typical 90s phone recording at moderate bitrate. */
export const MAX_PROFILE_VIDEO_BYTES = 80 * 1024 * 1024;

export const ALLOWED_VIDEO_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

export const VIDEO_ACCEPT_ATTR = "video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov";

export const VIDEO_FORMAT_HINT =
  "MP4, MOV, or WebM · max 90 seconds · max 80 MB";
