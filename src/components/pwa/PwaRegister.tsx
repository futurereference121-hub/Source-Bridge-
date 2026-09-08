"use client";

import { useEffect, useRef, useState } from "react";
import { PWA_SW_PATH } from "@/lib/pwa/constants";

function isUnsafeToReload(): boolean {
  if (typeof document === "undefined") return true;
  const path = window.location.pathname;
  if (path.startsWith("/live")) return true;
  // Unsent form / compose / upload surfaces
  const active = document.activeElement;
  if (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    active?.getAttribute("contenteditable") === "true"
  ) {
    return true;
  }
  if (document.querySelector("[data-pwa-defer-update='true']")) return true;
  return false;
}

/**
 * Registers the Source Bridge service worker once and surfaces a non-blocking
 * update affordance. Never force-reloads during Live or active form input.
 */
export function PwaRegister() {
  const registered = useRef(false);
  const [updateReady, setUpdateReady] = useState(false);
  const waitingWorker = useRef<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (registered.current) return;
    registered.current = true;

    let cancelled = false;

    void (async () => {
      try {
        const reg = await navigator.serviceWorker.register(PWA_SW_PATH, {
          scope: "/",
          updateViaCache: "none",
        });

        const trackWaiting = (sw: ServiceWorker | null | undefined) => {
          if (!sw) return;
          waitingWorker.current = sw;
          if (!cancelled) setUpdateReady(true);
        };

        if (reg.waiting) trackWaiting(reg.waiting);

        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              trackWaiting(reg.waiting || installing);
            }
          });
        });

        // Periodic check — quiet; no reload loops
        const interval = window.setInterval(() => {
          void reg.update().catch(() => {});
        }, 60 * 60 * 1000);

        return () => window.clearInterval(interval);
      } catch {
        // Registration failure must not break the app.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function applyUpdate() {
    const sw = waitingWorker.current;
    if (!sw) return;
    if (isUnsafeToReload()) {
      // Activate in background; user navigates later to pick up new HTML.
      sw.postMessage({ type: "SB_PWA_SKIP_WAITING" });
      setUpdateReady(false);
      return;
    }
    sw.postMessage({ type: "SB_PWA_SKIP_WAITING" });
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => {
        window.location.reload();
      },
      { once: true },
    );
    setUpdateReady(false);
  }

  if (!updateReady) return null;

  return (
    <div
      role="status"
      className="pointer-events-auto fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-1/2 z-[70] w-[min(100%-1.5rem,22rem)] -translate-x-1/2 rounded-xl border border-white/15 bg-[#04122a]/95 px-3 py-2.5 text-center text-sm text-white shadow-xl backdrop-blur-md md:bottom-6"
    >
      <p className="text-white/80">Update available</p>
      <button
        type="button"
        onClick={applyUpdate}
        className="mt-2 inline-flex h-10 min-w-[8rem] items-center justify-center rounded-lg bg-electric px-4 text-xs font-semibold uppercase tracking-[0.12em] text-white hover:bg-electric-hover"
      >
        Refresh
      </button>
    </div>
  );
}