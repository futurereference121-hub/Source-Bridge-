"use client";

import { useLiveRealtime } from "./useLiveRealtime";
import { LiveCommentsStack } from "./LiveCommentsStack";
import { LiveCommentComposer } from "./LiveCommentComposer";
import { LiveViewerCount } from "./LiveViewerCount";

type Props = {
  liveSessionId: string;
  active: boolean;
  /** Viewer: enter presence after genuine playback start. Broadcaster: false. */
  allowPresence: boolean;
  isBroadcaster: boolean;
  /** Capture Item / Report sheets — hide public comments, keep Ably connected. */
  suppressPublicUi?: boolean;
  /** Show composer (viewers only). */
  showComposer?: boolean;
};

/**
 * Single engagement overlay boundary for LivePlayer / GoLiveStudio.
 * Ably only — never remounts WHEP/WHIP video elements.
 */
export function LiveEngagementOverlay({
  liveSessionId,
  active,
  allowPresence,
  isBroadcaster,
  suppressPublicUi = false,
  showComposer = true,
}: Props) {
  const rt = useLiveRealtime({
    liveSessionId,
    active,
    allowPresence: allowPresence && !isBroadcaster,
    suppressCommentsUi: suppressPublicUi,
  });

  const hideStack = suppressPublicUi || !active;
  const hideComposer =
    suppressPublicUi ||
    !active ||
    isBroadcaster ||
    !showComposer ||
    !rt.available;

  return (
    <>
      <div className="pointer-events-none absolute right-4 top-16 z-[6] sm:top-[4.25rem]">
        <LiveViewerCount count={rt.viewerCount} available={rt.available && active} />
      </div>
      <LiveCommentsStack comments={rt.comments} hidden={hideStack} />
      {!isBroadcaster ? (
        <LiveCommentComposer
          hidden={hideComposer}
          disabled={!rt.available || !active}
          onSend={async (body, clientMessageId) => {
            const result = await rt.postComment(body, clientMessageId);
            if (!result.ok) return { ok: false as const, error: result.error };
            return { ok: true as const };
          }}
        />
      ) : null}
      {!rt.available && active && rt.error && !suppressPublicUi ? (
        <p className="pointer-events-none absolute bottom-14 left-3 z-[6] max-w-[70%] text-[10px] text-white/45">
          {rt.error}
        </p>
      ) : null}
    </>
  );
}
