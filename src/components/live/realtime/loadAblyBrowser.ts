"use client";

/**
 * Browser Ably loader — avoids Next.js SWC re-parsing ably's prebuilt bundle
 * (`super` keyword parse failure). Uses the official Ably CDN matching major v2
 * (same major as the npm `ably` server dependency). Server still uses npm `ably`.
 */

type AblyNamespace = {
  Realtime: new (options: Record<string, unknown>) => import("ably").Realtime;
};

declare global {
  interface Window {
    Ably?: AblyNamespace;
  }
}

const ABLY_CDN = "https://cdn.ably.com/lib/ably.min-2.js";

let loading: Promise<AblyNamespace> | null = null;

export async function loadAblyBrowser(): Promise<AblyNamespace> {
  if (typeof window === "undefined") {
    throw new Error("Ably browser client is only available in the browser");
  }
  if (window.Ably?.Realtime) return window.Ably;
  if (loading) return loading;

  loading = new Promise<AblyNamespace>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-sb-ably="1"]`,
    );
    if (existing && window.Ably?.Realtime) {
      resolve(window.Ably);
      return;
    }
    const script = document.createElement("script");
    script.src = ABLY_CDN;
    script.async = true;
    script.dataset.sbAbly = "1";
    script.onload = () => {
      if (window.Ably?.Realtime) {
        resolve(window.Ably);
      } else {
        loading = null;
        reject(new Error("Ably failed to load"));
      }
    };
    script.onerror = () => {
      loading = null;
      reject(new Error("Ably failed to load"));
    };
    document.head.appendChild(script);
  });

  return loading;
}
