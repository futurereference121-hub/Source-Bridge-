"use client";

import type { LiveCommentPublic } from "@/lib/live/realtime/types";

type Props = {
  comments: LiveCommentPublic[];
  /** When true (Capture sheet open), hide the stack without unmounting parents. */
  hidden?: boolean;
};

function displayName(c: LiveCommentPublic): string {
  if (c.commenter.username) return c.commenter.username;
  return c.commenter.name || "Member";
}

/**
 * Instagram-style rolling public comment stack — bottom-left over Live video.
 * Newest at bottom; older shift up. Does not remount video.
 */
export function LiveCommentsStack({ comments, hidden }: Props) {
  if (hidden || comments.length === 0) return null;
  return (
    <div
      className="pointer-events-none absolute bottom-[4.75rem] left-0 right-16 z-[6] flex max-h-[38%] flex-col justify-end gap-1.5 px-3 pb-1 sm:right-24"
      aria-live="polite"
      aria-relevant="additions"
    >
      {comments.map((c) => (
        <div
          key={c.id}
          className="flex max-w-[min(100%,20rem)] items-end gap-2 rounded-lg bg-black/35 px-2 py-1.5 backdrop-blur-[2px]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={
              c.commenter.photo ||
              "data:image/svg+xml," +
                encodeURIComponent(
                  `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect fill="%23334155" width="28" height="28"/><circle cx="14" cy="11" r="5" fill="%2394a3b8"/><ellipse cx="14" cy="24" rx="8" ry="6" fill="%2394a3b8"/></svg>`,
                )
            }
            alt=""
            className="h-7 w-7 shrink-0 rounded-full object-cover"
            width={28}
            height={28}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-semibold text-white/90">
              {displayName(c)}
            </p>
            <p className="break-words text-[12px] leading-snug text-white/85">
              {c.body}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
