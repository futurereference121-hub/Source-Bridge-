"use client";

import { type ReactNode, type MouseEvent } from "react";
import Link from "next/link";
import { useStoriesOptional } from "@/components/stories/StoryProvider";

type Props = {
  userId: string;
  isSelf?: boolean;
  profileHref?: string | null;
  size?: number;
  className?: string;
  children: ReactNode;
  /** When true, clicking with no story still uses onClickEmpty / link. */
  onClickEmpty?: () => void;
};

/**
 * Profile avatar wrapper with Story ring + click routing.
 */
export function StoryAvatar({
  userId,
  isSelf = false,
  profileHref,
  size = 64,
  className = "",
  children,
  onClickEmpty,
}: Props) {
  const stories = useStoriesOptional();
  const ring = stories?.rings[userId];
  const hasActive = Boolean(ring?.hasActiveStory);
  const hasUnseen = Boolean(ring?.hasUnseenStory);

  const ringClass = hasActive
    ? hasUnseen
      ? "ring-[3px] ring-electric shadow-[0_0_0_2px_rgba(2,11,28,1)]"
      : "ring-[3px] ring-electric/35 shadow-[0_0_0_2px_rgba(2,11,28,1)]"
    : "";

  function handleClick(e: MouseEvent) {
    if (!stories) return;
    if (isSelf) {
      e.preventDefault();
      e.stopPropagation();
      stories.onAvatarClick({ userId, isSelf: true, hasActiveStory: hasActive });
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

  const inner = (
    <span
      className={`relative inline-flex overflow-hidden rounded-xl bg-navy-mid ${ringClass} ${className}`}
      style={{ width: size, height: size }}
      onClick={handleClick}
      role={isSelf || hasActive ? "button" : undefined}
      tabIndex={isSelf || hasActive ? 0 : undefined}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleClick(e as unknown as MouseEvent);
        }
      }}
    >
      {children}
    </span>
  );

  if (!isSelf && !hasActive && profileHref) {
    return (
      <Link href={profileHref} className="inline-flex shrink-0" onClick={onClickEmpty}>
        {inner}
      </Link>
    );
  }

  return <span className="inline-flex shrink-0">{inner}</span>;
}
