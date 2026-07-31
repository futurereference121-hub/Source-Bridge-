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
import { useAppUi } from "@/components/providers/AppProviders";

type Props = {
  userId: string;
  isSelf?: boolean;
  profileHref?: string | null;
  size?: number;
  className?: string;
  children: ReactNode;
  onClickEmpty?: () => void;
  /** Show the “Add Story” text under the avatar (profile header). */
  showAddLabel?: boolean;
};

/**
 * Profile avatar with Story ring and owner-only Add Story control.
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
  const { account } = useAppUi();
  const ring = stories?.rings[userId];
  const hasActive = Boolean(ring?.hasActiveStory);
  const hasUnseen = Boolean(ring?.hasUnseenStory);
  const isAdmin = Boolean(account?.role === "ADMIN" || account?.isAdmin);
  const ownerControls = Boolean(isSelf && !isAdmin && stories && account);
  const labelVisible = showAddLabel ?? size >= 72;

  const ringClass = hasActive
    ? hasUnseen
      ? "ring-[3px] ring-electric shadow-[0_0_0_2px_rgba(2,11,28,1)]"
      : "ring-[3px] ring-electric/35 shadow-[0_0_0_2px_rgba(2,11,28,1)]"
    : "";

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

  const avatarFace = (
    <span
      className={`relative inline-flex overflow-hidden rounded-xl bg-navy-mid ${ringClass} ${className}`}
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

  const ownerBlock = ownerControls ? (
    <span className="inline-flex flex-col items-center gap-1.5">
      <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
        {avatarFace}
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
            right: -2,
            bottom: -2,
          }}
        >
          <Plus size={plusIcon} strokeWidth={2.75} aria-hidden />
        </button>
        {/* Clicking the face also opens the same owner flow */}
        <button
          type="button"
          className="absolute inset-0 z-[1] rounded-xl"
          aria-label={hasActive ? "Story options" : "Add Story"}
          onClick={addStory}
        />
      </span>
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
  ) : null;

  if (ownerControls) {
    return ownerBlock;
  }

  if (!hasActive && profileHref) {
    return (
      <Link
        href={profileHref}
        className="inline-flex shrink-0"
        onClick={onClickEmpty}
      >
        {avatarFace}
      </Link>
    );
  }

  return <span className="inline-flex shrink-0">{avatarFace}</span>;
}
