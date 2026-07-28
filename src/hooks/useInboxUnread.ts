"use client";

import { useCallback, useEffect, useState } from "react";
import { useAppUi } from "@/components/providers/AppProviders";

/** Shared unread message count for signed-in navigation. */
export function useInboxUnread(pollMs = 45_000) {
  const { signedIn, authReady } = useAppUi();
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!signedIn) {
      setCount(0);
      return;
    }
    try {
      const res = await fetch("/api/conversations?limit=1");
      if (!res.ok) return;
      const data = (await res.json()) as { unreadCount?: number };
      setCount(typeof data.unreadCount === "number" ? data.unreadCount : 0);
    } catch {
      /* keep last known */
    }
  }, [signedIn]);

  useEffect(() => {
    if (!authReady || !signedIn) {
      setCount(0);
      return;
    }
    void refresh();
    const id = window.setInterval(() => void refresh(), pollMs);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [authReady, signedIn, refresh, pollMs]);

  return { unreadCount: count, refreshUnread: refresh };
}
