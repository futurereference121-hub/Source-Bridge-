"use client";

import { useCallback, useEffect, useState } from "react";
import {
  isIosLikeDevice,
  isSafariBrowser,
  isStandaloneDisplay,
  type BeforeInstallPromptEventLike,
} from "@/lib/pwa/detect";

type InstallMode = "prompt" | "ios-guide" | "manual" | "hidden";

type PwaInstallState = {
  /** True when running as installed standalone app — hide GET THE APP. */
  isStandalone: boolean;
  mode: InstallMode;
  canPrompt: boolean;
  dismissedThisSession: boolean;
  iosSheetOpen: boolean;
  setIosSheetOpen: (open: boolean) => void;
  /** Trigger install / show guidance. Returns outcome for UI messaging. */
  requestInstall: () => Promise<"accepted" | "dismissed" | "guided" | "unavailable">;
};

let deferredPromptGlobal: BeforeInstallPromptEventLike | null = null;
let sessionDismissed = false;
let listenersBound = false;

function bindBeforeInstallPromptOnce() {
  if (typeof window === "undefined" || listenersBound) return;
  listenersBound = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPromptGlobal = e as BeforeInstallPromptEventLike;
    window.dispatchEvent(new Event("sb-pwa-installable"));
  });
  window.addEventListener("appinstalled", () => {
    deferredPromptGlobal = null;
    window.dispatchEvent(new Event("sb-pwa-installed"));
  });
}

export function usePwaInstall(): PwaInstallState {
  const [isStandalone, setIsStandalone] = useState(false);
  const [canPrompt, setCanPrompt] = useState(false);
  const [dismissedThisSession, setDismissedThisSession] = useState(false);
  const [iosSheetOpen, setIosSheetOpen] = useState(false);
  const [mode, setMode] = useState<InstallMode>("manual");

  const recompute = useCallback(() => {
    const standalone = isStandaloneDisplay();
    setIsStandalone(standalone);
    if (standalone) {
      setMode("hidden");
      setCanPrompt(false);
      return;
    }
    if (sessionDismissed) {
      setDismissedThisSession(true);
    }
    const promptAvailable = Boolean(deferredPromptGlobal);
    setCanPrompt(promptAvailable);
    if (promptAvailable) {
      setMode("prompt");
    } else if (isIosLikeDevice() && isSafariBrowser()) {
      setMode("ios-guide");
    } else {
      setMode("manual");
    }
  }, []);

  useEffect(() => {
    bindBeforeInstallPromptOnce();
    recompute();
    const onInstallable = () => recompute();
    const onInstalled = () => recompute();
    const onChange = () => recompute();
    window.addEventListener("sb-pwa-installable", onInstallable);
    window.addEventListener("sb-pwa-installed", onInstalled);
    const mq = window.matchMedia("(display-mode: standalone)");
    mq.addEventListener?.("change", onChange);
    return () => {
      window.removeEventListener("sb-pwa-installable", onInstallable);
      window.removeEventListener("sb-pwa-installed", onInstalled);
      mq.removeEventListener?.("change", onChange);
    };
  }, [recompute]);

  const requestInstall = useCallback(async () => {
    if (isStandaloneDisplay()) return "unavailable";

    if (deferredPromptGlobal) {
      try {
        await deferredPromptGlobal.prompt();
        const choice = await deferredPromptGlobal.userChoice;
        deferredPromptGlobal = null;
        setCanPrompt(false);
        if (choice.outcome === "dismissed") {
          sessionDismissed = true;
          setDismissedThisSession(true);
          setMode(isIosLikeDevice() ? "ios-guide" : "manual");
        } else {
          recompute();
        }
        return choice.outcome;
      } catch {
        deferredPromptGlobal = null;
        setCanPrompt(false);
        setMode("manual");
        return "unavailable";
      }
    }

    if (isIosLikeDevice()) {
      setIosSheetOpen(true);
      return "guided";
    }

    return "unavailable";
  }, [recompute]);

  return {
    isStandalone,
    mode,
    canPrompt,
    dismissedThisSession,
    iosSheetOpen,
    setIosSheetOpen,
    requestInstall,
  };
}