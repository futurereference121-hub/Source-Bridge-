/** Client-side purchase order surface sync — apply mutation / poll without full reload. */

export type PurchaseOrderSurfacePayload = {
  protectedTxnId?: string;
  order?: Record<string, unknown>;
  ordersVersion?: number;
  activityVersion?: number;
  version?: number;
};

export const PURCHASE_ORDER_CHANGED_EVENT = "sb:purchase-order-changed";

let lastAppliedVersion = 0;

function resolveVersion(payload: PurchaseOrderSurfacePayload): number {
  return (
    payload.version ??
    payload.ordersVersion ??
    payload.activityVersion ??
    Date.now()
  );
}

export function emitPurchaseOrderChanged(payload: PurchaseOrderSurfacePayload) {
  const version = resolveVersion(payload);
  if (version && version < lastAppliedVersion) {
    return;
  }
  lastAppliedVersion = Math.max(lastAppliedVersion, version || 0);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(PURCHASE_ORDER_CHANGED_EVENT, {
      detail: { ...payload, version },
    }),
  );
}

export function subscribePurchaseOrderChanged(
  handler: (payload: PurchaseOrderSurfacePayload) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<PurchaseOrderSurfacePayload>).detail;
    if (!detail) return;
    const version = resolveVersion(detail);
    if (version && version < lastAppliedVersion) return;
    if (version) lastAppliedVersion = Math.max(lastAppliedVersion, version);
    handler(detail);
  };
  window.addEventListener(PURCHASE_ORDER_CHANGED_EVENT, listener);
  return () => window.removeEventListener(PURCHASE_ORDER_CHANGED_EVENT, listener);
}
