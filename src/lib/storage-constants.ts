/** Shared upload limits — safe for client and server imports (no Node APIs). */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

export const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export const IMAGE_ACCEPT_ATTR = "image/jpeg,image/jpg,image/png,image/webp";
