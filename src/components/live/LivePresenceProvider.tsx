"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type LivePresenceKind = "live" | "was_live";

export type LivePresence = {
  kind: LivePresenceKind;
  sessionId: string;
  title: string;
};

type PresenceMap = Record<string, LivePresence>;

type LivePresenceContextValue = {
  available: boolean;
  presence: PresenceMap;
  refreshPresence: (userIds: string[]) => Promise<void>;
};

const LivePresenceContext = createContext<LivePresenceContextValue | null>(null);

const TTL_MS = 8_000;
const BATCH_MS = 60;

export function LivePresenceProvider({ children }: { children: ReactNode }) {
  const [available, setAvailable] = useState(false);
  const [presence, setPresence] = useState<PresenceMap>({});
  const fetchedAt = useRef(new Map<string, number>());
  const pending = useRef(new Set<string>());
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/live/status", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { available?: boolean }) => {
        if (!cancelled) setAvailable(Boolean(data.available));
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const flush = useCallback(async () => {
    timer.current = null;
    const ids = [...pending.current];
    pending.current.clear();
    if (!ids.length) return;
    try {
      const res = await fetch(
        `/api/live/presence?userIds=${encodeURIComponent(ids.join(","))}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = (await res.json()) as { presence?: PresenceMap };
      const now = Date.now();
      for (const id of ids) fetchedAt.current.set(id, now);
      if (data.presence) {
        setPresence((prev) => ({ ...prev, ...data.presence }));
      }
    } catch {
      /* next refresh retries */
    }
  }, []);

  const refreshPresence = useCallback(
    async (userIds: string[]) => {
      const now = Date.now();
      for (const id of userIds) {
        if (!id) continue;
        const last = fetchedAt.current.get(id) || 0;
        if (now - last < TTL_MS) continue;
        pending.current.add(id);
      }
      if (!pending.current.size) return;
      if (timer.current) return;
      timer.current = window.setTimeout(() => void flush(), BATCH_MS);
    },
    [flush],
  );

  const value = useMemo(
    () => ({ available, presence, refreshPresence }),
    [available, presence, refreshPresence],
  );

  return (
    <LivePresenceContext.Provider value={value}>
      {children}
    </LivePresenceContext.Provider>
  );
}

export function useLivePresenceOptional() {
  return useContext(LivePresenceContext);
}
