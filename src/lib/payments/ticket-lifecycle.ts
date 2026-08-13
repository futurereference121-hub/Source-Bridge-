/**
 * Pure Payment Ticket lifecycle helpers (no DB).
 * Shared by server domain code and client chat UI.
 */

/** Max concurrent non-terminal payment tickets per conversation. */
export const MAX_ACTIVE_PAYMENT_TICKETS = 3;

/**
 * Ticket row statuses that may still be "open" at the ticket table level.
 * Final activity is refined by ProtectedTransaction via resolveLifecycleStage.
 */
export const ACTIVE_TICKET_STATUSES = [
  "DRAFT",
  "PROPOSED",
  "ACCEPTED",
  "FUNDED",
] as const;

/** Historical / terminal ticket statuses that never block a new ticket. */
export const INACTIVE_TICKET_STATUSES = [
  "DECLINED",
  "CANCELLED",
  "SUPERSEDED",
  "DELETED",
  "VOIDED",
  "REFUNDED",
] as const;

/** Display stages that are closed (do not count toward the active cap). */
export const TERMINAL_LIFECYCLE_STAGES = [
  "COMPLETED",
  "RELEASED",
  "CANCELLED",
  "DECLINED",
  "SUPERSEDED",
  "DELETED",
  "VOIDED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
] as const;

/**
 * Derive a single display / gating lifecycle stage from PaymentTicket +
 * ProtectedTransaction. COMPLETED is the RELEASED terminal stage.
 */
export function resolveLifecycleStage(
  ticketStatus: string,
  protectedStatus: string | null,
  procReleased: boolean,
): string {
  if (
    ticketStatus === "DECLINED" ||
    ticketStatus === "SUPERSEDED" ||
    ticketStatus === "CANCELLED" ||
    ticketStatus === "DELETED" ||
    ticketStatus === "VOIDED"
  ) {
    return ticketStatus;
  }
  const st = protectedStatus || ticketStatus;
  if (st === "RELEASED") return "COMPLETED";
  if (st === "REFUNDED" || st === "PARTIALLY_REFUNDED") return st;
  if (st === "DISPUTED") return "DISPUTED";
  if (["IN_INSPECTION", "READY_TO_RELEASE"].includes(st)) return st;
  if (["IN_TRANSIT", "DELIVERED", "AWAITING_SHIPMENT"].includes(st)) return st;
  if (procReleased || st === "PROCUREMENT_RELEASED") return "ITEM_FUNDS_RELEASED";
  if (st === "FUNDED" || ticketStatus === "FUNDED") return "FUNDED";
  // Dual-accept is done — buyer still needs to fund.
  if (
    ticketStatus === "ACCEPTED" ||
    st === "ACCEPTED" ||
    st === "AWAITING_PAYMENT"
  ) {
    return "AGREED_AWAITING_PAYMENT";
  }
  if (ticketStatus === "PROPOSED") return "PROPOSED";
  return ticketStatus;
}

/** Human-facing stage on the chat card badge. */
export function lifecycleLabel(stage: string): string {
  switch (stage) {
    case "PROPOSED":
      return "PROPOSED";
    case "AGREED_AWAITING_PAYMENT":
    case "ACCEPTED":
    case "AWAITING_PAYMENT":
      return "AGREED · AWAITING PAYMENT";
    case "FUNDED":
      return "FUNDED";
    case "ITEM_FUNDS_RELEASED":
    case "PROCUREMENT_RELEASED":
      return "ITEM FUNDS RELEASED";
    case "AWAITING_SHIPMENT":
    case "IN_TRANSIT":
    case "SHIPPED":
      return "SHIPPED";
    case "DELIVERED":
      return "AWAITING BUYER";
    case "IN_INSPECTION":
    case "INSPECTION":
      return "INSPECTION";
    case "READY_TO_RELEASE":
      return "RELEASING";
    case "COMPLETED":
    case "RELEASED":
      return "COMPLETED";
    case "DISPUTED":
      return "ISSUE REPORTED";
    case "SUPERSEDED":
      return "SUPERSEDED";
    case "DECLINED":
      return "DECLINED";
    case "CANCELLED":
      return "CANCELLED";
    case "DELETED":
    case "VOIDED":
      return "DELETED";
    default:
      return stage.replace(/_/g, " ");
  }
}

export function isActiveTicketStatus(status: string): boolean {
  return (ACTIVE_TICKET_STATUSES as readonly string[]).includes(status);
}

export function isInactiveTicketStatus(status: string): boolean {
  return (INACTIVE_TICKET_STATUSES as readonly string[]).includes(status);
}

export function isTerminalLifecycleStage(stage: string): boolean {
  return (TERMINAL_LIFECYCLE_STAGES as readonly string[]).includes(stage);
}

/**
 * True when a ticket still counts toward the per-conversation active cap
 * and still participates in multi-ticket independence (not completed/cancelled).
 *
 * Single shared helper for: chat badges, active counts, create block,
 * historical styling, and action gates.
 */
export function isActiveLifecycleTicket(opts: {
  ticketStatus: string;
  protectedStatus?: string | null;
  procReleased?: boolean;
  lifecycleStage?: string | null;
}): boolean {
  if (isInactiveTicketStatus(opts.ticketStatus)) return false;
  const stage =
    opts.lifecycleStage ||
    resolveLifecycleStage(
      opts.ticketStatus,
      opts.protectedStatus ?? null,
      Boolean(opts.procReleased),
    );
  if (isTerminalLifecycleStage(stage)) return false;
  return true;
}

/** Collapsed historical-style cancelled/declined/superseded rows. */
export function isSubtleHistoricalTicket(ticketStatus: string): boolean {
  return (
    ticketStatus === "DECLINED" ||
    ticketStatus === "SUPERSEDED" ||
    ticketStatus === "CANCELLED" ||
    ticketStatus === "DELETED" ||
    ticketStatus === "VOIDED"
  );
}

export function isCompletedLifecycleTicket(opts: {
  ticketStatus: string;
  protectedStatus?: string | null;
  lifecycleStage?: string | null;
}): boolean {
  const stage =
    opts.lifecycleStage ||
    resolveLifecycleStage(
      opts.ticketStatus,
      opts.protectedStatus ?? null,
      false,
    );
  return stage === "COMPLETED" || stage === "RELEASED";
}

/** Subtle system-message copy for collapsed terminal tickets. */
export function subtleHistoricalLabel(ticketStatus: string): string {
  switch (ticketStatus) {
    case "DECLINED":
      return "Payment agreement declined";
    case "SUPERSEDED":
      return "Payment agreement superseded";
    case "CANCELLED":
      return "Payment agreement cancelled";
    case "DELETED":
    case "VOIDED":
      return "Payment agreement removed";
    default:
      return "Payment agreement closed";
  }
}

/**
 * Seller share still owed after procurement + final transfers.
 * remainingSellerEntitlement = sellerEntitled − procurement − final
 */
export function remainingSellerEntitlementMinor(opts: {
  sellerEntitledMinor: number;
  procurementTransferredMinor: number;
  finalTransferredMinor: number;
}): number {
  return Math.max(
    0,
    (opts.sellerEntitledMinor ?? 0) -
      (opts.procurementTransferredMinor ?? 0) -
      (opts.finalTransferredMinor ?? 0),
  );
}

/**
 * Amber "item funds released… remaining protected" copy.
 * Show only when procurement has moved AND residual seller share remains
 * AND the ticket is still financially open (not RELEASED/COMPLETED with residual 0).
 */
export function shouldShowItemFundsRemainingProtectedMessage(opts: {
  procurementTransferredMinor: number;
  finalTransferredMinor?: number;
  sellerEntitledMinor: number;
  protectedStatus?: string | null;
  lifecycleStage?: string | null;
  ticketStatus?: string;
}): boolean {
  const proc = opts.procurementTransferredMinor ?? 0;
  if (proc <= 0) return false;
  const remaining = remainingSellerEntitlementMinor({
    sellerEntitledMinor: opts.sellerEntitledMinor ?? 0,
    procurementTransferredMinor: proc,
    finalTransferredMinor: opts.finalTransferredMinor ?? 0,
  });
  if (remaining <= 0) return false;
  if (
    isCompletedLifecycleTicket({
      ticketStatus: opts.ticketStatus || opts.protectedStatus || "FUNDED",
      protectedStatus: opts.protectedStatus ?? null,
      lifecycleStage: opts.lifecycleStage ?? null,
    })
  ) {
    return false;
  }
  if (opts.protectedStatus === "RELEASED") return false;
  return true;
}

/**
 * True when a party has approved the *current* ticket revision.
 * Coerces numeric-ish values so JSON/DB quirks cannot hide Accept.
 */
export function partyAcceptedCurrentRevision(
  approvedRevision: number | null | undefined,
  revision: number,
): boolean {
  if (approvedRevision == null) return false;
  return Number(approvedRevision) === Number(revision);
}

export type TicketAcceptanceState = {
  buyerAcceptedCurrentRevision: boolean;
  sellerAcceptedCurrentRevision: boolean;
  bothAcceptedCurrentRevision: boolean;
  iAmBuyer: boolean;
  iAmSeller: boolean;
  isParty: boolean;
  myAcceptedCurrentRevision: boolean;
  /** Outstanding party must Accept Agreement (+ Decline). */
  canAccept: boolean;
  canDecline: boolean;
  /** Already-accepted party waits for the other — never the outstanding party. */
  waitingForOther: boolean;
  waitingForRole: "buyer" | "seller" | null;
  waitingLabel: string | null;
  bothAcceptedLabel: string | null;
};

/**
 * Authoritative dual-accept UI/server derivation for the current revision.
 * Proposer auto-approval on create is reflected in buyer/sellerApprovedRevision.
 */
export function deriveTicketAcceptanceState(opts: {
  viewerId: string;
  buyerId: string;
  sellerId: string;
  revision: number;
  buyerApprovedRevision: number | null | undefined;
  sellerApprovedRevision: number | null | undefined;
  status: string;
}): TicketAcceptanceState {
  const buyerAcceptedCurrentRevision = partyAcceptedCurrentRevision(
    opts.buyerApprovedRevision,
    opts.revision,
  );
  const sellerAcceptedCurrentRevision = partyAcceptedCurrentRevision(
    opts.sellerApprovedRevision,
    opts.revision,
  );
  const bothAcceptedCurrentRevision =
    buyerAcceptedCurrentRevision && sellerAcceptedCurrentRevision;
  const iAmBuyer = Boolean(opts.viewerId) && opts.viewerId === opts.buyerId;
  const iAmSeller = Boolean(opts.viewerId) && opts.viewerId === opts.sellerId;
  const isParty = iAmBuyer || iAmSeller;
  const myAcceptedCurrentRevision = iAmBuyer
    ? buyerAcceptedCurrentRevision
    : iAmSeller
      ? sellerAcceptedCurrentRevision
      : false;
  const openForAccept =
    opts.status === "PROPOSED" || opts.status === "DRAFT";
  const canAccept = isParty && openForAccept && !myAcceptedCurrentRevision;
  const canDecline = canAccept;
  const waitingForOther =
    isParty &&
    openForAccept &&
    myAcceptedCurrentRevision &&
    !bothAcceptedCurrentRevision;
  const waitingForRole: "buyer" | "seller" | null = waitingForOther
    ? iAmBuyer
      ? "seller"
      : "buyer"
    : null;
  const waitingLabel = waitingForRole
    ? waitingForRole === "seller"
      ? "Waiting for seller to accept."
      : "Waiting for buyer to accept."
    : null;
  const bothAcceptedLabel = bothAcceptedCurrentRevision
    ? "Agreement accepted by both parties"
    : null;

  return {
    buyerAcceptedCurrentRevision,
    sellerAcceptedCurrentRevision,
    bothAcceptedCurrentRevision,
    iAmBuyer,
    iAmSeller,
    isParty,
    myAcceptedCurrentRevision,
    canAccept,
    canDecline,
    waitingForOther,
    waitingForRole,
    waitingLabel,
    bothAcceptedLabel,
  };
}
