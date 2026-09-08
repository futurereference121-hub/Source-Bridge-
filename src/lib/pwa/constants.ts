/** Shared PWA identity — keep in sync with manifest + offline page. */
export const PWA_NAME = "Source Bridge";
export const PWA_SHORT_NAME = "Source Bridge";
export const PWA_DESCRIPTION =
  "If you're somewhere, or you're going somewhere, you can help someone.";
/** Canonical production origin used for scope documentation / tests. */
export const PWA_CANONICAL_ORIGIN = "https://www.sourcebridge.app";
export const PWA_THEME_COLOR = "#020B1C";
export const PWA_BACKGROUND_COLOR = "#020B1C";
export const PWA_START_URL = "/";
export const PWA_SCOPE = "/";
export const PWA_DISPLAY = "standalone" as const;
/** Cache name prefix owned exclusively by this PWA implementation. */
export const PWA_CACHE_PREFIX = "sb-pwa-";
export const PWA_CACHE_VERSION = "sb-pwa-v1";
export const PWA_SW_PATH = "/sw.js";