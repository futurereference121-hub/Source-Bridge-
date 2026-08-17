"use client";

import type { NotificationType } from "@/lib/types";

export type NotificationSoundKind = "opportunity" | "status" | "message";

const SOUND_SRC: Record<NotificationSoundKind, string> = {
  opportunity: "/sounds/opportunity.wav",
  status: "/sounds/status.wav",
  message: "/sounds/message.wav",
};

/** Higher wins when several notifications land in the same batch. */
const PRIORITY: Record<NotificationSoundKind, number> = {
  opportunity: 3,
  message: 2,
  status: 1,
};

const VOLUME_MULTIPLIER: Record<string, number> = {
  low: 0.22,
  medium: 0.5,
  high: 0.9,
};

const COOLDOWN_MS = 1500;
const BATCH_WINDOW_MS = 250;

/** Maps a Notification.type to the sound family that should play for it. */
export function soundKindForNotificationType(
  type: NotificationType,
): NotificationSoundKind | null {
  switch (type) {
    case "OPPORTUNITY":
      return "opportunity";
    case "STATUS":
      return "status";
    case "MESSAGE":
    case "SOURCING_REQUEST":
    case "LISTING_ENQUIRY":
    case "OPPORTUNITY_ENQUIRY":
    case "PAYMENT_TICKET":
    case "PAYMENT_STATUS":
    case "PAYMENT_SHIPPING":
    case "PAYMENT_DISPUTE":
      return "message";
    default:
      return null;
  }
}

type SoundConfig = { enabled: boolean; volume: "low" | "medium" | "high" };

const config: SoundConfig = { enabled: true, volume: "medium" };
let unlocked = false;
const audioElements: Partial<Record<NotificationSoundKind, HTMLAudioElement>> = {};
let lastPlayedAt = 0;
let batchTimer: ReturnType<typeof setTimeout> | null = null;
const pendingKinds = new Set<NotificationSoundKind>();

export function configureNotificationSounds(next: Partial<SoundConfig>): void {
  if (typeof next.enabled === "boolean") config.enabled = next.enabled;
  if (next.volume && next.volume in VOLUME_MULTIPLIER) config.volume = next.volume;
}

function getAudio(kind: NotificationSoundKind): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  let el = audioElements[kind];
  if (!el) {
    el = new Audio(SOUND_SRC[kind]);
    el.preload = "auto";
    audioElements[kind] = el;
  }
  return el;
}

/** Primes playback so later programmatic .play() calls aren't blocked by autoplay policy. */
export function unlockNotificationAudio(): void {
  if (unlocked || typeof window === "undefined") return;
  unlocked = true;
  (Object.keys(SOUND_SRC) as NotificationSoundKind[]).forEach((kind) => {
    const el = getAudio(kind);
    if (!el) return;
    const original = el.volume;
    el.volume = 0;
    el.play()
      .then(() => {
        el.pause();
        el.currentTime = 0;
        el.volume = original;
      })
      .catch(() => {
        el.volume = original;
      });
  });
}

/** Registers one-time listeners so audio unlocks on the user's first interaction. */
export function registerNotificationAudioUnlock(): () => void {
  if (typeof window === "undefined" || unlocked) return () => {};
  const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "touchstart"];
  const handler = () => {
    unlockNotificationAudio();
    events.forEach((evt) => window.removeEventListener(evt, handler));
  };
  events.forEach((evt) => window.addEventListener(evt, handler, { once: true }));
  return () => events.forEach((evt) => window.removeEventListener(evt, handler));
}

function playNow(kind: NotificationSoundKind, volumeOverride?: SoundConfig["volume"]): void {
  const el = getAudio(kind);
  if (!el) return;
  try {
    el.currentTime = 0;
    const level = volumeOverride ?? config.volume;
    el.volume = Math.min(1, Math.max(0, VOLUME_MULTIPLIER[level] ?? VOLUME_MULTIPLIER.medium));
    void el.play().catch(() => {
      /* blocked by autoplay policy until a user gesture unlocks audio */
    });
  } catch {
    /* ignore playback errors */
  }
}

function flushBatch(): void {
  batchTimer = null;
  if (!pendingKinds.size) return;
  let winner: NotificationSoundKind = "status";
  let winnerPriority = -1;
  for (const kind of pendingKinds) {
    if (PRIORITY[kind] > winnerPriority) {
      winnerPriority = PRIORITY[kind];
      winner = kind;
    }
  }
  pendingKinds.clear();
  lastPlayedAt = Date.now();
  playNow(winner);
}

/**
 * Queue a sound for a real notification event. Multiple calls within a short
 * window are batched into a single sound (highest priority wins), and plays
 * are throttled to at most one every COOLDOWN_MS.
 */
export function playNotificationSound(kind: NotificationSoundKind): void {
  if (!config.enabled) return;
  pendingKinds.add(kind);
  if (batchTimer) return;

  const elapsed = Date.now() - lastPlayedAt;
  const delay = elapsed < COOLDOWN_MS ? COOLDOWN_MS - elapsed + BATCH_WINDOW_MS : BATCH_WINDOW_MS;
  batchTimer = setTimeout(flushBatch, delay);
}

/** Bypasses enabled/cooldown checks — used by the settings "Test sound" buttons. */
export function playTestNotificationSound(
  kind: NotificationSoundKind,
  volume: SoundConfig["volume"],
): void {
  unlockNotificationAudio();
  playNow(kind, volume);
}
