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
  inspectionEndsAt?: string | null;
  gpPayoutPhase?: string | null;
  gpPayoutHeadline?: string | null;
  gpPayoutProgress?: {
    phase?: string | null;
    headline?: string | null;
    hideReleaseActions?: boolean | null;
  } | null;
  outboundKind?: string | null;
  outboundStatus?: string | null;
  hideReleaseActions?: boolean | null;
  canReleaseProcurement?: boolean | null;
  actions?: { canReleaseProcurement?: boolean | null } | null;
  procurementTransferredMinor?: number | null;
  finalTransferredMinor?: number | null;
  books?: {
    procurementTransferredMinor?: number | null;
    finalTransferredMinor?: number | null;
  } | null;
};

function normalizeTicketSlice(t: TicketStateSlice): TicketStateSlice {
  return {
    ...t,
    canReleaseProcurement:
      t.canReleaseProcurement ?? t.actions?.canReleaseProcurement ?? null,
    hideReleaseActions:
      t.hideReleaseActions ?? t.gpPayoutProgress?.hideReleaseActions ?? null,
    procurementTransferredMinor:
      t.procurementTransferredMinor ?? t.books?.procurementTransferredMinor ?? null,
    finalTransferredMinor:
      t.finalTransferredMinor ?? t.books?.finalTransferredMinor ?? null,
  };
}

function ticketDisplayProgressKey(t: TicketStateSlice): string {
  const n = normalizeTicketSlice(t);
  const gp = n.gpPayoutProgress;
  return [
    n.inspectionEndsAt || "",
    n.gpPayoutPhase || gp?.phase || "",
    n.gpPayoutHeadline || gp?.headline || "",
    n.outboundKind || "",
    n.outboundStatus || "",
    n.hideReleaseActions ? "1" : "0",
    n.canReleaseProcurement ? "1" : "0",
    String(n.procurementTransferredMinor ?? 0),
    String(n.finalTransferredMinor ?? 0),
  ].join("|");
}

function incomingRegressesPayoutBooks(
  incoming: TicketStateSlice,
  existing: TicketStateSlice,
): boolean {
  const inProc = Number(incoming.procurementTransferredMinor ?? 0);
  const exProc = Number(existing.procurementTransferredMinor ?? 0);
  const inFinal = Number(incoming.finalTransferredMinor ?? 0);
  const exFinal = Number(existing.finalTransferredMinor ?? 0);
  if (!Number.isFinite(inProc) || !Number.isFinite(inFinal)) return false;
  if (!Number.isFinite(exProc) || !Number.isFinite(exFinal)) return false;
  return exProc > inProc || exFinal > inFinal;
}

function procurementReleaseControlsClosed(t: TicketStateSlice): boolean {
  const n = normalizeTicketSlice(t);
  const status = String(n.outboundStatus || "").toUpperCase();
  if (status === "FAILED") return false;
  if (n.hideReleaseActions) return true;
  if (n.canReleaseProcurement === false && n.outboundKind === "PROCUREMENT") {
    return true;
  }
  const kind = String(n.outboundKind || "").toUpperCase();
  return kind === "PROCUREMENT" && Boolean(status);
}

function incomingReopensProcurementRelease(
  incoming: TicketStateSlice,
  existing: TicketStateSlice,
): boolean {
  if (!procurementReleaseControlsClosed(existing)) return false;
  const n = normalizeTicketSlice(incoming);
  return n.canReleaseProcurement === true;
}

/** Stale GP hide=true after a PROCUREMENT advance must not cover remainder actions. */
function incomingHidesRemainderAfterProcurement(
  incoming: TicketStateSlice,
  existing: TicketStateSlice,
): boolean {
  const n = normalizeTicketSlice(incoming);
  const e = normalizeTicketSlice(existing);
  if (n.hideReleaseActions !== true) return false;
  if (e.hideReleaseActions === true) return false;
  const kind = String(n.outboundKind || e.outboundKind || "").toUpperCase();
  return kind === "PROCUREMENT";
}

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
  if (incomingReopensProcurementRelease(incoming, existing)) return false;
  if (incomingHidesRemainderAfterProcurement(incoming, existing)) return false;
  if (incomingRegressesPayoutBooks(incoming, existing)) return false;
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
  if (ticketDisplayProgressKey(incoming) !== ticketDisplayProgressKey(existing)) {
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
