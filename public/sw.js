/* Source Bridge PWA service worker — install + safe static assets only.
 * Never caches /api, auth, personalized pages, Live, payments, messaging, or media credentials.
 * Cache prefix: sb-pwa- (only this implementation's caches are pruned on activate).
 */
const CACHE_VERSION = "sb-pwa-v1";
const CACHE_PREFIX = "sb-pwa-";
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      await cache.addAll(PRECACHE_URLS);
      // Do not skipWaiting — let clients activate on their own terms (no Live interrupt).
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION)
          .map((key) => caches.delete(key)),
      );
      // Claim only after explicit client message (see message handler).
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "SB_PWA_SKIP_WAITING") {
    self.skipWaiting();
  }
  if (data.type === "SB_PWA_CLIENTS_CLAIM") {
    event.waitUntil(self.clients.claim());
  }
});

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

/** Paths that must never be cached or stale-served. */
function isNeverCachePath(pathname) {
  if (pathname.startsWith("/api/")) return true;
  if (pathname.startsWith("/admin")) return true;
  if (pathname.startsWith("/inbox")) return true;
  if (pathname.startsWith("/messages")) return true;
  if (pathname.startsWith("/profile")) return true;
  if (pathname.startsWith("/checkout")) return true;
  if (pathname.startsWith("/live")) return true;
  if (pathname.startsWith("/sign-in")) return true;
  if (pathname.startsWith("/join")) return true;
  if (pathname.startsWith("/onboarding")) return true;
  if (pathname.startsWith("/check-email")) return true;
  if (pathname.startsWith("/verify-email")) return true;
  if (pathname.startsWith("/activity")) return true;
  if (pathname.startsWith("/search")) return true;
  if (pathname.startsWith("/explore")) return true;
  if (pathname.startsWith("/status")) return true;
  if (pathname.startsWith("/opportunities")) return true;
  if (pathname.startsWith("/members")) return true;
  if (pathname.startsWith("/marketplace")) return true;
  if (pathname.startsWith("/uploads")) return true;
  if (pathname.startsWith("/_next/data")) return true;
  return false;
}

function isImmutableNextStatic(pathname) {
  return pathname.startsWith("/_next/static/");
}

function isPrecacheAsset(pathname) {
  return (
    pathname === OFFLINE_URL ||
    pathname.startsWith("/icons/") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/manifest.webmanifest/"
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Never touch cross-origin (Cloudflare, Ably, payment processors, Mux, etc.)
  if (!isSameOrigin(url)) return;

  const { pathname } = url;

  // Never intercept WebSocket upgrades or non-http(s)
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // Sensitive / personalized / realtime / financial — network only, no cache put
  if (isNeverCachePath(pathname)) {
    event.respondWith(
      fetch(request).catch(async () => {
        if (request.mode === "navigate") {
          const cache = await caches.open(CACHE_VERSION);
          const offline = await cache.match(OFFLINE_URL);
          if (offline) return offline;
        }
        return new Response("Network unavailable", { status: 503, statusText: "Offline" });
      }),
    );
    return;
  }

  // Navigations: network-first, offline → branded offline page (never stale app HTML)
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const cache = await caches.open(CACHE_VERSION);
          const offline = await cache.match(OFFLINE_URL);
          return offline || new Response("Offline", { status: 503 });
        }
      })(),
    );
    return;
  }

  // Immutable hashed Next static assets — cache-first
  if (isImmutableNextStatic(pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          return new Response("Network unavailable", { status: 503 });
        }
      })(),
    );
    return;
  }

  // Icons / offline / manifest — cache-first
  if (isPrecacheAsset(pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          return cached || new Response("Network unavailable", { status: 503 });
        }
      })(),
    );
    return;
  }

  // Everything else same-origin: network only (no cache write)
});