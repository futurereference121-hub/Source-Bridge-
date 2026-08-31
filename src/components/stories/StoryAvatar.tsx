"use client";

import {
  useCallback,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { useStoriesOptional } from "@/components/stories/StoryProvider";
import { useLivePresenceOptional } from "@/components/live/LivePresenceProvider";
import { LiveBadge } from "@/components/live/LiveBadge";
import { useAppUi } from "@/components/providers/AppProviders";

type Props = {
  userId: string;
  isSelf?: boolean;
  profileHref?: string | null;
  size?: number;
  /**
   * Face-only styles (rounded crop, border, soft shadow).
   * Do NOT pass Tailwind `ring-*` here — the Story ring lives on the outer shell.
   */
  className?: string;
  children: ReactNode;
  onClickEmpty?: () => void;
  /** Show the “Add Story” text under the avatar (profile header). */
  showAddLabel?: boolean;
};

/** Outer padding so box-shadow ring is never clipped by overflow-hidden parents. */
const RING_PAD = 4;

/**
 * Profile avatar with Story ring and owner-only Add Story control.
 *
 * Ring is painted on an OUTER shell (no overflow-hidden). The image crop
 * lives on an INNER face. This avoids Tailwind `ring-*` being clipped.
 */
export function StoryAvatar({
  userId,
  isSelf = false,
  profileHref,
  size = 64,
  className = "",
  children,
  onClickEmpty,
  showAddLabel,
}: Props) {
  const stories = useStoriesOptional();
  const livePresence = useLivePresenceOptional();
  const live = livePresence?.presence[userId];
  const isLive = live?.kind === "live";
  const { account } = useAppUi();
  const ring = stories?.rings[userId];
  const hasActive = Boolean(ring?.hasActiveStory);
  const hasUnseen = Boolean(ring?.hasUnseenStory);
  const isAdmin = Boolean(account?.role === "ADMIN" || account?.isAdmin);
  const ownerControls = Boolean(isSelf && !isAdmin && stories && account);
  const labelVisible = showAddLabel ?? size >= 72;

  // Unseen = strong luminous blue + soft gold glow; seen = solid blue, no gold.
  // Uses box-shadow (not Tailwind ring) so it cannot be clipped by the face crop.
  const shellRingClass = isLive
    ? "shadow-[0_0_0_3px_#dc2626,0_0_0_5px_#020b1c,0_0_16px_2px_rgba(220,38,38,0.55)]"
    : hasActive
      ? hasUnseen
        ? "shadow-[0_0_0_3px_#3b82f6,0_0_0_5px_#020b1c,0_0_16px_2px_rgba(59,130,246,0.65),0_0_22px_1px_rgba(212,168,75,0.4)]"
        : "shadow-[0_0_0_3px_rgba(59,130,246,0.78),0_0_0_5px_#020b1c]"
      : "";

  const faceIdleEdge = hasActive ? "" : "ring-1 ring-white/10";

  const addStory = useCallback(
    (e?: MouseEvent | KeyboardEvent) => {
      e?.preventDefault();
      e?.stopPropagation();
      if (!stories || !ownerControls) return;
      stories.onAvatarClick({
        userId,
        isSelf: true,
        hasActiveStory: hasActive,
      });
    },
    [stories, ownerControls, userId, hasActive],
  );

  function handleAvatarClick(e: MouseEvent) {
    if (isLive && live?.sessionId && !ownerControls) {
      e.preventDefault();
      e.stopPropagation();
      window.location.assign(`/live/${live.sessionId}`);
      return;
    }
    if (!stories) return;
    if (ownerControls) {
      addStory(e);
      return;
    }
    if (hasActive) {
      e.preventDefault();
      e.stopPropagation();
      stories.openStory(userId);
      return;
    }
    onClickEmpty?.();
  }

  const badgeSize = Math.max(18, Math.round(size * 0.28));
  const plusIcon = Math.max(10, Math.round(badgeSize * 0.55));
  const outerSize = size + RING_PAD * 2;

  const face = (
    <span
      className={`relative inline-flex overflow-hidden rounded-xl bg-navy-mid ${faceIdleEdge} ${className}`}
      style={{ width: size, height: size }}
      onClick={ownerControls ? undefined : handleAvatarClick}
      role={!ownerControls && (isSelf || hasActive) ? "button" : undefined}
      tabIndex={!ownerControls && (isSelf || hasActive) ? 0 : undefined}
      onKeyDown={
        !ownerControls
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleAvatarClick(e as unknown as MouseEvent);
              }
            }
          : undefined
      }
    >
      {children}
    </span>
  );

  const shell = (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-[14px] ${shellRingClass}`}
      style={{
        width: outerSize,
        height: outerSize,
        padding: RING_PAD,
      }}
      data-story-ring={hasActive ? (hasUnseen ? "unseen" : "seen") : "none"}
      data-live-ring={isLive ? "live" : live?.kind === "was_live" ? "was-live" : "none"}
    >
      {face}
      {isLive ? (
        <span className="pointer-events-none absolute -bottom-0.5 left-1/2 z-10 -translate-x-1/2">
          <LiveBadge />
        </span>
      ) : null}
      {ownerControls ? (
        <>
          <button
            type="button"
            onClick={addStory}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") addStory(e);
            }}
            aria-label={hasActive ? "Add to Story" : "Add Story"}
            title={hasActive ? "Add to Story" : "Add Story"}
            className="absolute z-10 flex items-center justify-center rounded-full border-2 border-[#020b1c] bg-electric text-white shadow-md transition hover:bg-electric-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
            style={{
              width: badgeSize,
              height: badgeSize,
              // Sit on the face corner — inside the ring padding so it never covers the ring.
              right: Math.max(0, RING_PAD - 1),
              bottom: Math.max(0, RING_PAD - 1),
            }}
          >
            <Plus size={plusIcon} strokeWidth={2.75} aria-hidden />
          </button>
          <button
            type="button"
            className="absolute z-[1] rounded-xl"
            style={{
              inset: RING_PAD,
            }}
            aria-label={hasActive ? "Story options" : "Add Story"}
            onClick={addStory}
          />
        </>
      ) : null}
    </span>
  );

  if (ownerControls) {
    return (
      <span className="inline-flex flex-col items-center gap-1.5">
        {shell}
        {labelVisible ? (
          <button
            type="button"
            onClick={addStory}
            className="text-[10px] font-semibold uppercase tracking-[0.14em] text-electric hover:text-electric-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric"
          >
            {hasActive ? "Add to Story" : "Add Story"}
          </button>
        ) : null}
      </span>
    );
  }

  if (isLive && live?.sessionId && !ownerControls) {
    return (
      <Link href={`/live/${live.sessionId}`} className="inline-flex shrink-0">
        {shell}
      </Link>
    );
  }

  if (!hasActive && profileHref) {
    return (
      <Link
        href={profileHref}
        className="inline-flex shrink-0"
        onClick={onClickEmpty}
      >
        {shell}
      </Link>
    );
  }

  return <span className="inline-flex shrink-0">{shell}</span>;
}
