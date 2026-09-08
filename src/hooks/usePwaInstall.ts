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
  /** True after first client-side display-mode check (avoids standalone flash). */
  ready: boolean;
  /** True when running as installed standalone app — hide GET THE APP. */
  isStandalone: boolean;
  mode: InstallMode;
  canPrompt: boolean;
  dismissedThisSession: boolean;
  iosSheetOpen: boolean;
  setIosSheetOpen: (open: boolean) => void;
  manualSheetOpen: boolean;
  setManualSheetOpen: (open: boolean) => void;
  /** Trigger install / show guidance. Returns outcome for UI messaging. */
  requestInstall: () => Promise<"accepted" | "dismissed" | "guided" | "unavailable">;
};

let deferredPromptGlobal: BeforeInstallPromptEventLike | null = null;
let sessionDismissed = false;
let listenersBound = false;

/** Shared sheet coordination — only one install dialog at a time across placements. */
let iosSheetOpenGlobal = false;
let manualSheetOpenGlobal = false;
const sheetListeners = new Set<() => void>();

function notifySheetListeners() {
  sheetListeners.forEach((fn) => fn());
}

function setIosSheetOpenGlobal(open: boolean) {
  iosSheetOpenGlobal = open;
  if (open) manualSheetOpenGlobal = false;
  notifySheetListeners();
}

function setManualSheetOpenGlobal(open: boolean) {
  manualSheetOpenGlobal = open;
  if (open) iosSheetOpenGlobal = false;
  notifySheetListeners();
}

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
    setIosSheetOpenGlobal(false);
    setManualSheetOpenGlobal(false);
    window.dispatchEvent(new Event("sb-pwa-installed"));
  });
}

export function usePwaInstall(): PwaInstallState {
  const [ready, setReady] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [canPrompt, setCanPrompt] = useState(false);
  const [dismissedThisSession, setDismissedThisSession] = useState(false);
  const [iosSheetOpen, setIosSheetOpenState] = useState(false);
  const [manualSheetOpen, setManualSheetOpenState] = useState(false);
  const [mode, setMode] = useState<InstallMode>("manual");

  const recompute = useCallback(() => {
    const standalone = isStandaloneDisplay();
    setIsStandalone(standalone);
    if (standalone) {
      setMode("hidden");
      setCanPrompt(false);
      setIosSheetOpenGlobal(false);
      setManualSheetOpenGlobal(false);
      return;
    }
    if (sessionDismissed) {
      setDismissedThisSession(true);
    }
    const promptAvailable = Boolean(deferredPromptGlobal);
    setCanPrompt(promptAvailable);
    // Visibility must NOT depend on beforeinstallprompt — only mode for press behavior.
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
    setReady(true);
    const onInstallable = () => recompute();
    const onInstalled = () => recompute();
    const onChange = () => recompute();
    const onSheets = () => {
      setIosSheetOpenState(iosSheetOpenGlobal);
      setManualSheetOpenState(manualSheetOpenGlobal);
    };
    sheetListeners.add(onSheets);
    onSheets();
    window.addEventListener("sb-pwa-installable", onInstallable);
    window.addEventListener("sb-pwa-installed", onInstalled);
    const mq = window.matchMedia("(display-mode: standalone)");
    mq.addEventListener?.("change", onChange);
    return () => {
      sheetListeners.delete(onSheets);
      window.removeEventListener("sb-pwa-installable", onInstallable);
      window.removeEventListener("sb-pwa-installed", onInstalled);
      mq.removeEventListener?.("change", onChange);
    };
  }, [recompute]);

  const setIosSheetOpen = useCallback((open: boolean) => {
    setIosSheetOpenGlobal(open);
  }, []);

  const setManualSheetOpen = useCallback((open: boolean) => {
    setManualSheetOpenGlobal(open);
  }, []);

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
          // Keep CTA visible — fall back to manual guidance mode, do not hide.
          setMode(isIosLikeDevice() ? "ios-guide" : "manual");
        } else {
          recompute();
        }
        return choice.outcome;
      } catch {
        deferredPromptGlobal = null;
        setCanPrompt(false);
        setMode("manual");
        setManualSheetOpenGlobal(true);
        return "guided";
      }
    }

    if (isIosLikeDevice()) {
      setIosSheetOpenGlobal(true);
      return "guided";
    }

    // Native event delayed/unavailable — never silent-fail; show accurate steps.
    setManualSheetOpenGlobal(true);
    return "guided";
  }, [recompute]);

  return {
    ready,
    isStandalone,
    mode,
    canPrompt,
    dismissedThisSession,
    iosSheetOpen,
    setIosSheetOpen,
    manualSheetOpen,
    setManualSheetOpen,
    requestInstall,
  };
}
