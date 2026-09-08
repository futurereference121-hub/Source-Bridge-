/** Capability-first PWA detection helpers (no fragile UA branching for installability). */

export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia("(display-mode: standalone)");
  if (mq.matches) return true;
  // iOS Safari legacy
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return Boolean(nav.standalone);
}

export function isIosLikeDevice(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || "";
  if (/iPhone|iPad|iPod/i.test(platform)) return true;
  // iPadOS reports as Mac with touch
  if (/Mac/i.test(platform) && navigator.maxTouchPoints > 1) return true;
  return /iPhone|iPad|iPod/i.test(nav.userAgent);
}

export function isSafariBrowser(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  const isSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|Chrome|Chromium|Android/i.test(ua);
  return isSafari || (isIosLikeDevice() && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua));
}

export type BeforeInstallPromptEventLike = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};