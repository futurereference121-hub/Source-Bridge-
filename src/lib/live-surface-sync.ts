export const LIVE_CHANGED_EVENT = "sb:live-changed";

export type LiveSurfacePayload = {
  sessionId: string;
  memberId: string;
  status: string;
  version?: number;
};

export function emitLiveChanged(payload: LiveSurfacePayload) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LIVE_CHANGED_EVENT, { detail: payload }));
}

export function subscribeLiveChanged(
  handler: (payload: LiveSurfacePayload) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (e: Event) => {
    handler((e as CustomEvent<LiveSurfacePayload>).detail);
  };
  window.addEventListener(LIVE_CHANGED_EVENT, listener);
  return () => window.removeEventListener(LIVE_CHANGED_EVENT, listener);
}
