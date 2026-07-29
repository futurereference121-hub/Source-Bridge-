/** Shared upload limits — safe for client and server imports (no Node APIs). */

/** Max size accepted by the upload API after client compression (under Vercel body limit). */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB

/** Max size of a photo picked from camera/gallery before client-side compression. */
export const MAX_SOURCE_IMAGE_BYTES = 30 * 1024 * 1024; // 30 MB

export const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

/** Types we accept from the device and convert client-side to JPEG/WebP. */
export const CONVERTIBLE_IMAGE_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

export const IMAGE_ACCEPT_ATTR =
  "image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif,image/*";

export const IMAGE_FORMAT_HINT =
  "JPG, PNG, WebP, or HEIC · large photos are compressed automatically";
