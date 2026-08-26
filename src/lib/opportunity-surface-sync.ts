/** Client-side Opportunity surface sync — notify Explore without full reload. */

export type OpportunitySurfacePayload = {
  memberId?: string;
  memberSlug?: string;
  opportunity: {
    id: string;
    postedAt: string;
    version?: number;
  } | null;
  /** Sequence from mutation; ignore older responses. */
  version?: number;
};

export const OPPORTUNITY_CHANGED_EVENT = "sb:opportunity-changed";

let lastAppliedVersion = 0;

export function emitOpportunityChanged(payload: OpportunitySurfacePayload) {
  const version =
    payload.version ??
    payload.opportunity?.version ??
    (payload.opportunity ? Date.parse(payload.opportunity.postedAt) : Date.now());
  if (version && version < lastAppliedVersion) {
    return; // stale response — do not overwrite newer UI
  }
  lastAppliedVersion = Math.max(lastAppliedVersion, version || 0);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(OPPORTUNITY_CHANGED_EVENT, {
      detail: { ...payload, version },
    }),
  );
}

export function subscribeOpportunityChanged(
  handler: (payload: OpportunitySurfacePayload) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<OpportunitySurfacePayload>).detail;
    if (!detail) return;
    const version =
      detail.version ??
      detail.opportunity?.version ??
      (detail.opportunity ? Date.parse(detail.opportunity.postedAt) : 0);
    if (version && version < lastAppliedVersion) return;
    if (version) lastAppliedVersion = Math.max(lastAppliedVersion, version);
    handler(detail);
  };
  window.addEventListener(OPPORTUNITY_CHANGED_EVENT, listener);
  return () => window.removeEventListener(OPPORTUNITY_CHANGED_EVENT, listener);
}
