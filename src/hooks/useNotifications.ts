"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppUi } from "@/components/providers/AppProviders";
import type { NotificationItem } from "@/lib/types";

const POLL_MS = 45_000;
const LAST_SEEN_KEY = "sb_notifications_last_seen_id";

type NotificationsSnapshot = {
  items: NotificationItem[];
  unreadCount: number;
  loading: boolean;
};

let snapshot: NotificationsSnapshot = { items: [], unreadCount: 0, loading: false };
const subscribers = new Set<(s: NotificationsSnapshot) => void>();
const newItemListeners = new Set<(items: NotificationItem[]) => void>();

let pollTimer: ReturnType<typeof setInterval> | null = null;
let inFlight: Promise<void> | null = null;
let lastSeenId: string | null | undefined; // undefined = not loaded from sessionStorage yet

function readLastSeenId(): string | null {
  if (lastSeenId !== undefined) return lastSeenId;
  try {
    lastSeenId = sessionStorage.getItem(LAST_SEEN_KEY);
  } catch {
    lastSeenId = null;
  }
  return lastSeenId;
}

function writeLastSeenId(id: string) {
  lastSeenId = id;
  try {
    sessionStorage.setItem(LAST_SEEN_KEY, id);
  } catch {
    /* sessionStorage unavailable (private mode, etc.) — in-memory value still applies */
  }
}

function publish(next: NotificationsSnapshot) {
  snapshot = next;
  subscribers.forEach((fn) => fn(snapshot));
}

async function fetchNotifications(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await fetch("/api/notifications?limit=30");
      if (!res.ok) return;
      const data = (await res.json()) as {
        items?: NotificationItem[];
        unreadCount?: number;
      };
      const items = data.items ?? [];
      const unreadCount = data.unreadCount ?? 0;

      const seen = readLastSeenId();
      if (seen !== null) {
        const freshItems: NotificationItem[] = [];
        for (const item of items) {
          if (item.id === seen) break;
          freshItems.push(item);
        }
        if (freshItems.length) {
          newItemListeners.forEach((fn) => fn(freshItems));
        }
      }
      if (items[0]) {
        writeLastSeenId(items[0].id);
      }

      publish({ items, unreadCount, loading: false });
    } catch {
      publish({ ...snapshot, loading: false });
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function ensurePolling() {
  if (pollTimer) return;
  void fetchNotifications();
  pollTimer = setInterval(() => void fetchNotifications(), POLL_MS);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** Subscribe to raw "new notifications since last seen" events (used for sound playback). */
export function subscribeToNewNotifications(
  fn: (items: NotificationItem[]) => void,
): () => void {
  newItemListeners.add(fn);
  return () => newItemListeners.delete(fn);
}

/**
 * Polls the notification centre every 20s while signed in. Multiple hook
 * instances share one underlying poll loop and cache, so mounting this in
 * both a listener and the bell doesn't double the network traffic.
 */
export function useNotifications() {
  const { signedIn, authReady } = useAppUi();
  const [state, setState] = useState(snapshot);
  const activeRef = useRef(false);

  useEffect(() => {
    const listener = (s: NotificationsSnapshot) => setState(s);
    subscribers.add(listener);
    return () => {
      subscribers.delete(listener);
    };
  }, []);

  useEffect(() => {
    const shouldPoll = authReady && signedIn;
    activeRef.current = shouldPoll;
    if (shouldPoll) {
      ensurePolling();
    } else {
      stopPolling();
      publish({ items: [], unreadCount: 0, loading: false });
    }
    return () => {
      // Leave the shared poller running for other mounted consumers; only
      // fully stop when nobody else is subscribed.
      if (subscribers.size === 0) stopPolling();
    };
  }, [authReady, signedIn]);

  const refresh = useCallback(() => fetchNotifications(), []);

  const markRead = useCallback(async (ids?: string[]) => {
    try {
      const res = await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids && ids.length ? { ids } : { all: true }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { unreadCount?: number };
      publish({
        items: snapshot.items.map((item) =>
          !ids || ids.includes(item.id) ? { ...item, read: true } : item,
        ),
        unreadCount: data.unreadCount ?? 0,
        loading: false,
      });
    } catch {
      /* keep last known state */
    }
  }, []);

  return {
    items: state.items,
    unreadCount: state.unreadCount,
    loading: state.loading,
    markRead,
    refresh,
  };
}
