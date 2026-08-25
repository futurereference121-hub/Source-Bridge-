/** Client-side Status surface sync — apply mutation response without full reload. */

export type StatusSurfacePayload = {
  memberId?: string;
  memberSlug?: string;
  status: {
    id: string;
    text: string;
    postedAt: string;
    expiresAt: string;
    version?: number;
  } | null;
  /** Sequence from mutation; ignore older responses. */
  version?: number;
};

export const STATUS_CHANGED_EVENT = "sb:status-changed";

let lastAppliedVersion = 0;

export function emitStatusChanged(payload: StatusSurfacePayload) {
  const version =
    payload.version ??
    payload.status?.version ??
    (payload.status ? Date.parse(payload.status.postedAt) : Date.now());
  if (version && version < lastAppliedVersion) {
    return; // stale response — do not overwrite newer UI
  }
  lastAppliedVersion = Math.max(lastAppliedVersion, version || 0);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(STATUS_CHANGED_EVENT, {
      detail: { ...payload, version },
    }),
  );
}

export function subscribeStatusChanged(
  handler: (payload: StatusSurfacePayload) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<StatusSurfacePayload>).detail;
    if (!detail) return;
    const version =
      detail.version ??
      detail.status?.version ??
      (detail.status ? Date.parse(detail.status.postedAt) : 0);
    if (version && version < lastAppliedVersion) return;
    if (version) lastAppliedVersion = Math.max(lastAppliedVersion, version);
    handler(detail);
  };
  window.addEventListener(STATUS_CHANGED_EVENT, listener);
  return () => window.removeEventListener(STATUS_CHANGED_EVENT, listener);
}
