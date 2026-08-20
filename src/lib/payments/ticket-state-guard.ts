/**
 * Client + server helpers: stale poll/mutation responses must not regress ticket UI.
 * Critical invariant: funded / post-fund lifecycle must never revert to unfunded UX.
 */

export type TicketStateSlice = {
  updatedAt?: string | null;
  lastMeaningfulActivityAt?: string | null;
  revision?: number | null;
  status?: string | null;
  protectedTxnStatus?: string | null;
  fundedAt?: string | null;
  paymentIntentStatus?: string | null;
  lifecycleStage?: string | null;
  buyerApprovedRevision?: number | null;
  sellerApprovedRevision?: number | null;
};

const FUNDED_TICKET_STATUSES = new Set(["FUNDED", "ACCEPTED"]);
const FUNDED_PROTECTED_STATUSES = new Set([
  "FUNDED",
  "PROCUREMENT_RELEASED",
  "AWAITING_SHIPMENT",
  "IN_TRANSIT",
  "DELIVERED",
  "IN_INSPECTION",
  "READY_TO_RELEASE",
  "RELEASED",
  "DISPUTED",
  "PARTIALLY_REFUNDED",
]);

const TERMINAL_LIFECYCLE = new Set([
  "COMPLETED",
  "RELEASED",
  "REFUNDED",
  "CANCELLED",
  "EXPIRED",
  "DECLINED",
]);

function stateEpoch(t: TicketStateSlice): number {
  const candidates = [
    t.updatedAt,
    t.lastMeaningfulActivityAt,
  ].filter(Boolean) as string[];
  let max = 0;
  for (const iso of candidates) {
    const ms = Date.parse(iso);
    if (Number.isFinite(ms) && ms > max) max = ms;
  }
  // Tie-breaker: revision + approval bits encode accept progress within same ms.
  const rev = Number(t.revision ?? 0);
  const buyer = Number(t.buyerApprovedRevision ?? -1);
  const seller = Number(t.sellerApprovedRevision ?? -1);
  return max * 1000 + rev * 10 + (buyer === rev ? 1 : 0) + (seller === rev ? 2 : 0);
}

export function ticketAppearsFunded(t: TicketStateSlice): boolean {
  if (t.fundedAt) return true;
  if (t.paymentIntentStatus === "succeeded") return true;
  const ps = (t.protectedTxnStatus || "").toUpperCase();
  if (ps && FUNDED_PROTECTED_STATUSES.has(ps)) return true;
  const st = (t.status || "").toUpperCase();
  if (st === "FUNDED") return true;
  const lc = (t.lifecycleStage || "").toUpperCase();
  if (
    lc &&
    lc !== "AWAITING_PAYMENT" &&
    lc !== "PROPOSED" &&
    lc !== "ACCEPTED" &&
    !lc.includes("PROPOSED")
  ) {
    if (FUNDED_PROTECTED_STATUSES.has(lc) || TERMINAL_LIFECYCLE.has(lc)) {
      return true;
    }
  }
  return false;
}

/** True when `incoming` is strictly newer than `existing` and safe to apply. */
export function shouldApplyTicketUpdate(
  incoming: TicketStateSlice,
  existing: TicketStateSlice | null | undefined,
): boolean {
  if (!existing) return true;
  const incomingFunded = ticketAppearsFunded(incoming);
  const existingFunded = ticketAppearsFunded(existing);
  // Never regress funded UI (P3: delayed pre-funded response).
  if (existingFunded && !incomingFunded) return false;
  const inEpoch = stateEpoch(incoming);
  const exEpoch = stateEpoch(existing);
  if (inEpoch > exEpoch) return true;
  if (inEpoch < exEpoch) return false;
  // Same epoch — prefer incoming when it advances acceptance or lifecycle.
  const rev = Number(incoming.revision ?? 0);
  const buyerIn = Number(incoming.buyerApprovedRevision ?? -1);
  const sellerIn = Number(incoming.sellerApprovedRevision ?? -1);
  const buyerEx = Number(existing.buyerApprovedRevision ?? -1);
  const sellerEx = Number(existing.sellerApprovedRevision ?? -1);
  if (buyerIn === rev && buyerEx !== rev) return true;
  if (sellerIn === rev && sellerEx !== rev) return true;
  if (incomingFunded && !existingFunded) return true;
  if (
    (incoming.lifecycleStage || "") !== (existing.lifecycleStage || "") &&
    incomingFunded
  ) {
    return true;
  }
  return false;
}

/** Merge two ticket snapshots — always prefer the newer authoritative state. */
export function mergeTicketStatePreferNewer<T extends TicketStateSlice>(
  existing: T,
  incoming: T,
): T {
  if (shouldApplyTicketUpdate(incoming, existing)) {
    return { ...existing, ...incoming };
  }
  return existing;
}
