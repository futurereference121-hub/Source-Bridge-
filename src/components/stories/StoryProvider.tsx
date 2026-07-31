"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { StoryViewer } from "@/components/stories/StoryViewer";
import { StoryCreateModal } from "@/components/stories/StoryCreateModal";
import { StoryOwnerMenu } from "@/components/stories/StoryOwnerMenu";
import { StoryManageModal } from "@/components/stories/StoryManageModal";
import { useAppUi } from "@/components/providers/AppProviders";

type RingMap = Record<
  string,
  { hasActiveStory: boolean; hasUnseenStory: boolean }
>;

type StoryContextValue = {
  rings: RingMap;
  refreshRings: (userIds: string[]) => Promise<void>;
  openStory: (userId: string) => void;
  onAvatarClick: (opts: {
    userId: string;
    isSelf: boolean;
    hasActiveStory?: boolean;
  }) => void;
};

const StoryContext = createContext<StoryContextValue | null>(null);

export function StoryProvider({ children }: { children: ReactNode }) {
  const { account, showToast } = useAppUi();
  const [rings, setRings] = useState<RingMap>({});
  const [viewerUserId, setViewerUserId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [ownerMenuOpen, setOwnerMenuOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const refreshRings = useCallback(async (userIds: string[]) => {
    const unique = [...new Set(userIds.filter(Boolean))];
    if (!unique.length) return;
    try {
      const res = await fetch(
        `/api/stories/rings?userIds=${encodeURIComponent(unique.join(","))}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { rings?: RingMap };
      if (data.rings) {
        setRings((prev) => ({ ...prev, ...data.rings }));
      }
    } catch {
      /* ignore */
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
      const ring = rings[opts.userId];
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
      // No active story: caller should navigate to profile (default Link behaviour).
    },
    [account, rings],
  );

  const value = useMemo(
    () => ({
      rings,
      refreshRings,
      openStory,
      onAvatarClick,
    }),
    [rings, refreshRings, openStory, onAvatarClick],
  );

  return (
    <StoryContext.Provider value={value}>
      {children}
      {viewerUserId ? (
        <StoryViewer
          userId={viewerUserId}
          onClose={() => {
            setViewerUserId(null);
            if (account?.id) void refreshRings([account.id, viewerUserId]);
          }}
        />
      ) : null}
      <StoryCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => {
          setCreateOpen(false);
          showToast("Story added.");
          if (account?.id) {
            void refreshRings([account.id]);
            setViewerUserId(account.id);
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
          if (account?.id) void refreshRings([account.id]);
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
