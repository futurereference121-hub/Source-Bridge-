"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { StoryViewer } from "@/components/stories/StoryViewer";
import { StoryCreateModal } from "@/components/stories/StoryCreateModal";
import { StoryOwnerMenu } from "@/components/stories/StoryOwnerMenu";
import { StoryManageModal } from "@/components/stories/StoryManageModal";
import { useAppUi } from "@/components/providers/AppProviders";

type RingState = { hasActiveStory: boolean; hasUnseenStory: boolean };
type RingMap = Record<string, RingState>;

type RefreshOpts = { force?: boolean };

type StoryContextValue = {
  rings: RingMap;
  /** Batched, debounced, TTL-cached ring fetch — safe to call from many list rows. */
  refreshRings: (userIds: string[], opts?: RefreshOpts) => Promise<void>;
  /** Drop TTL so the next refreshRings hits the network (after READY / delete). */
  invalidateRings: (userIds?: string[]) => void;
  openStory: (userId: string) => void;
  onAvatarClick: (opts: {
    userId: string;
    isSelf: boolean;
    hasActiveStory?: boolean;
  }) => void;
};

const StoryContext = createContext<StoryContextValue | null>(null);

const RING_TTL_MS = 25_000;
const BATCH_FLUSH_MS = 60;

export function StoryProvider({ children }: { children: ReactNode }) {
  const { account, showToast } = useAppUi();
  const [rings, setRings] = useState<RingMap>({});
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [ownerMenuOpen, setOwnerMenuOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const ringsRef = useRef<RingMap>({});
  const fetchedAtRef = useRef<Map<string, number>>(new Map());
  const pendingRef = useRef<Set<string>>(new Set());
  const flushTimerRef = useRef<number | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const waitersRef = useRef<Array<() => void>>([]);

  ringsRef.current = rings;

  const flushPending = useCallback(async () => {
    flushTimerRef.current = null;
    if (inFlightRef.current) {
      await inFlightRef.current;
    }

    const ids = [...pendingRef.current];
    pendingRef.current.clear();
    if (!ids.length) {
      const waiters = waitersRef.current.splice(0);
      waiters.forEach((w) => w());
      return;
    }

    const run = (async () => {
      try {
        const res = await fetch(
          `/api/stories/rings?userIds=${encodeURIComponent(ids.join(","))}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { rings?: RingMap };
        if (!data.rings) return;
        const now = Date.now();
        for (const id of ids) {
          fetchedAtRef.current.set(id, now);
        }
        setRings((prev) => ({ ...prev, ...data.rings }));
      } catch {
        /* ignore — next refresh retries */
      } finally {
        inFlightRef.current = null;
        const waiters = waitersRef.current.splice(0);
        waiters.forEach((w) => w());
        // Nested pending accumulated during flight
        if (pendingRef.current.size && flushTimerRef.current == null) {
          flushTimerRef.current = window.setTimeout(() => {
            void flushPending();
          }, BATCH_FLUSH_MS);
        }
      }
    })();

    inFlightRef.current = run;
    await run;
  }, []);

  const refreshRings = useCallback(
    (userIds: string[], opts?: RefreshOpts) => {
      const unique = [...new Set(userIds.filter(Boolean))];
      if (!unique.length) return Promise.resolve();

      const now = Date.now();
      let queued = 0;
      for (const id of unique) {
        if (!opts?.force) {
          const at = fetchedAtRef.current.get(id);
          if (at && now - at < RING_TTL_MS && id in ringsRef.current) {
            continue;
          }
        } else {
          fetchedAtRef.current.delete(id);
        }
        pendingRef.current.add(id);
        queued += 1;
      }
      if (!queued && !pendingRef.current.size) return Promise.resolve();

      return new Promise<void>((resolve) => {
        waitersRef.current.push(resolve);
        if (flushTimerRef.current != null) return;
        flushTimerRef.current = window.setTimeout(() => {
          void flushPending();
        }, BATCH_FLUSH_MS);
      });
    },
    [flushPending],
  );

  const invalidateRings = useCallback((userIds?: string[]) => {
    if (!userIds?.length) {
      fetchedAtRef.current.clear();
      return;
    }
    for (const id of userIds) {
      fetchedAtRef.current.delete(id);
    }
  }, []);

  const openStory = useCallback((userId: string) => {
    setViewerUserId(userId);
  }, []);

  const onAvatarClick = useCallback(
    (opts: {
      userId: string;
      isSelf: boolean;
      hasActiveStory?: boolean;
    }) => {
      const ring = ringsRef.current[opts.userId];
      const active =
        opts.hasActiveStory ?? ring?.hasActiveStory ?? false;

      if (opts.isSelf) {
        if (!account) return;
        if (active) {
          setOwnerMenuOpen(true);
        } else {
          setCreateOpen(true);
        }
        return;
      }

      if (active) {
        setViewerUserId(opts.userId);
      }
    },
    [account],
  );

  const value = useMemo(
    () => ({
      rings,
      refreshRings,
      invalidateRings,
      openStory,
      onAvatarClick,
    }),
    [rings, refreshRings, invalidateRings, openStory, onAvatarClick],
  );

  return (
    <StoryContext.Provider value={value}>
      {children}
      {viewerUserId ? (
        <StoryViewer
          userId={viewerUserId}
          onClose={() => {
            const closed = viewerUserId;
            setViewerUserId(null);
            if (account?.id) {
              invalidateRings([account.id, closed]);
              void refreshRings([account.id, closed], { force: true });
            } else {
              invalidateRings([closed]);
              void refreshRings([closed], { force: true });
            }
          }}
        />
      ) : null}
      <StoryCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={(result) => {
          setCreateOpen(false);
          // Processing clips have no ring yet — never open the viewer here.
          showToast(
            result.processing ? "Your Story is processing." : "Story added.",
          );
          if (account?.id) {
            invalidateRings([account.id]);
            void refreshRings([account.id], { force: true });
          }
        }}
      />
      <StoryOwnerMenu
        open={ownerMenuOpen}
        onClose={() => setOwnerMenuOpen(false)}
        onView={() => {
          setOwnerMenuOpen(false);
          if (account?.id) setViewerUserId(account.id);
        }}
        onAdd={() => {
          setOwnerMenuOpen(false);
          setCreateOpen(true);
        }}
        onManage={() => {
          setOwnerMenuOpen(false);
          setManageOpen(true);
        }}
      />
      <StoryManageModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        onChanged={() => {
          if (account?.id) {
            invalidateRings([account.id]);
            void refreshRings([account.id], { force: true });
          }
        }}
      />
    </StoryContext.Provider>
  );
}

export function useStories() {
  const ctx = useContext(StoryContext);
  if (!ctx) {
    throw new Error("useStories must be used within StoryProvider");
  }
  return ctx;
}

/** Safe hook when StoryProvider may be absent. */
export function useStoriesOptional() {
  return useContext(StoryContext);
}
