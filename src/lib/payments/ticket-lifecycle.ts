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

/**
 * Explicit Buyer selection for a 2-party conversation.
 * Sourcer is always the other participant — never inferred from proposer.
 */
export function assignConversationTicketRoles(opts: {
  participantIds: string[];
  buyerId: string;
  proposedSellerId?: string | null;
}):
  | { ok: true; buyerId: string; sellerId: string }
  | { ok: false; message: string; code: string } {
  const ids = [
    ...new Set(
      (opts.participantIds || []).map((id) => (id || "").trim()).filter(Boolean),
    ),
  ];
  if (ids.length !== 2) {
    return {
      ok: false,
      message: "Conversation needs two parties",
      code: "NEED_TWO_PARTIES",
    };
  }
  const buyerId = (opts.buyerId || "").trim();
  if (!buyerId || !ids.includes(buyerId)) {
    return {
      ok: false,
      message: "Buyer must be a conversation participant",
      code: "INVALID_BUYER",
    };
  }
  const sellerId = ids.find((id) => id !== buyerId) || "";
  if (!sellerId || sellerId === buyerId) {
    return {
      ok: false,
      message: "Buyer and sourcer must be different people",
      code: "SELF_TRADE",
    };
  }
  const proposedSeller = (opts.proposedSellerId || "").trim();
  if (proposedSeller && proposedSeller !== sellerId) {
    return {
      ok: false,
      message: "Sourcer must be the other conversation participant",
      code: "INVALID_SOURCER",
    };
  }
  return { ok: true, buyerId, sellerId };
}

/** Only the designated buyer may start funding — never proposer or sourcer-by-default. */
export function viewerMayFundTicket(opts: {
  viewerId: string;
  buyerId: string;
}): boolean {
  const viewerId = (opts.viewerId || "").trim();
  const buyerId = (opts.buyerId || "").trim();
  return Boolean(viewerId && buyerId && viewerId === buyerId);
}

/** Seller-side Stripe destination / entitlement always follows sellerId (sourcer). */
export function sellerDestinationUserId(opts: {
  sellerId: string;
  proposerId?: string | null;
  buyerId?: string | null;
}): string {
  return (opts.sellerId || "").trim();
}

/**
 * Three distinct concepts on a Payment Ticket:
 * - proposer / createdBy: who submitted this revision (auto-approves it)
 * - buyer: who pays (ticket.buyerId)
 * - sourcer / seller: who receives seller entitlement (ticket.sellerId)
 *
 * Creating a ticket does NOT imply creator = buyer.
 */
export type TicketRoleModel = {
  proposerId: string;
  buyerId: string;
  sellerId: string;
  /** Conversation peer who did not propose this revision. */
  counterpartyId: string | null;
  rolesValid: boolean;
  iAmProposer: boolean;
  iAmCounterparty: boolean;
  iAmBuyer: boolean;
  iAmSeller: boolean;
};

export function resolveTicketRoleModel(opts: {
  createdById?: string | null;
  buyerId: string;
  sellerId: string;
  viewerId?: string | null;
}): TicketRoleModel {
  const proposerId = (opts.createdById || "").trim();
  const buyerId = (opts.buyerId || "").trim();
  const sellerId = (opts.sellerId || "").trim();
  const viewerId = (opts.viewerId || "").trim();
  const rolesValid =
    Boolean(proposerId && buyerId && sellerId) &&
    buyerId !== sellerId &&
    (proposerId === buyerId || proposerId === sellerId);
  const counterpartyId = !rolesValid
    ? null
    : proposerId === buyerId
      ? sellerId
      : buyerId;
  return {
    proposerId,
    buyerId,
    sellerId,
    counterpartyId,
    rolesValid,
    iAmProposer: Boolean(viewerId) && viewerId === proposerId,
    iAmCounterparty: Boolean(viewerId && counterpartyId && viewerId === counterpartyId),
    iAmBuyer: Boolean(viewerId) && viewerId === buyerId,
    iAmSeller: Boolean(viewerId) && viewerId === sellerId,
  };
}

export function partyApprovedForRole(
  role: "buyer" | "seller",
  opts: {
    buyerApprovedRevision: number | null | undefined;
    sellerApprovedRevision: number | null | undefined;
    revision: number;
  },
): boolean {
  return partyAcceptedCurrentRevision(
    role === "buyer" ? opts.buyerApprovedRevision : opts.sellerApprovedRevision,
    opts.revision,
  );
}

export type TicketAcceptanceState = {
  buyerAcceptedCurrentRevision: boolean;
  sellerAcceptedCurrentRevision: boolean;
  bothAcceptedCurrentRevision: boolean;
  iAmBuyer: boolean;
  iAmSeller: boolean;
  isParty: boolean;
  iAmProposer: boolean;
  iAmCounterparty: boolean;
  myAcceptedCurrentRevision: boolean;
  rolesValid: boolean;
  proposerId: string;
  counterpartyId: string | null;
  /** Outstanding COUNTERPARTY must Accept Agreement (+ Decline). */
  canAccept: boolean;
  canDecline: boolean;
  /** Proposer waits — never shown to the outstanding counterparty. */
  waitingForOther: boolean;
  waitingForRole: "buyer" | "seller" | null;
  waitingLabel: string | null;
  bothAcceptedLabel: string | null;
  viewerRoleLabel: "buyer" | "sourcer" | null;
  /** True when proposer is not buyer or sourcer — do not guess; require revision. */
  needsRoleRevision: boolean;
};

/**
 * Authoritative dual-accept derivation.
 * After a new proposal/revision:
 * - proposer auto-approved their own terms (buyerApprovedRevision or sellerApprovedRevision)
 * - counterparty (NOT proposer) always needs Accept
 * Financial roles (buyer/sourcer) are independent of who proposed.
 */
export function deriveTicketAcceptanceState(opts: {
  viewerId: string;
  createdById?: string | null;
  buyerId: string;
  sellerId: string;
  revision: number;
  buyerApprovedRevision: number | null | undefined;
  sellerApprovedRevision: number | null | undefined;
  status: string;
  counterpartyUsername?: string | null;
}): TicketAcceptanceState {
  const roles = resolveTicketRoleModel({
    createdById: opts.createdById,
    buyerId: opts.buyerId,
    sellerId: opts.sellerId,
    viewerId: opts.viewerId,
  });
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
  const isParty = roles.iAmBuyer || roles.iAmSeller;
  const myAcceptedCurrentRevision = roles.iAmBuyer
    ? buyerAcceptedCurrentRevision
    : roles.iAmSeller
      ? sellerAcceptedCurrentRevision
      : false;
  const openForAccept =
    opts.status === "PROPOSED" || opts.status === "DRAFT";

  // Counterparty = conversation peer who is not the proposer.
  // If roles are malformed (proposer not buyer or seller), do not guess — no Accept.
  const canAccept =
    roles.rolesValid &&
    roles.iAmCounterparty &&
    openForAccept &&
    !myAcceptedCurrentRevision;
  const canDecline = canAccept;
  const waitingForOther =
    roles.rolesValid &&
    roles.iAmProposer &&
    openForAccept &&
    myAcceptedCurrentRevision &&
    !bothAcceptedCurrentRevision;
  const waitingForRole: "buyer" | "seller" | null = waitingForOther
    ? roles.proposerId === roles.buyerId
      ? "seller"
      : "buyer"
    : null;
  const otherName = opts.counterpartyUsername
    ? `@${opts.counterpartyUsername.replace(/^@/, "")}`
    : waitingForRole === "seller"
      ? "the sourcer"
      : "the buyer";
  const waitingLabel = waitingForOther
    ? `Proposal sent. Waiting for ${otherName} to accept.`
    : null;
  const bothAcceptedLabel = bothAcceptedCurrentRevision
    ? "Agreement accepted by both parties"
    : null;
  const viewerRoleLabel: "buyer" | "sourcer" | null = roles.iAmBuyer
    ? "buyer"
    : roles.iAmSeller
      ? "sourcer"
      : null;
  const needsRoleRevision = !roles.rolesValid && openForAccept;

  return {
    buyerAcceptedCurrentRevision,
    sellerAcceptedCurrentRevision,
    bothAcceptedCurrentRevision,
    iAmBuyer: roles.iAmBuyer,
    iAmSeller: roles.iAmSeller,
    isParty,
    iAmProposer: roles.iAmProposer,
    iAmCounterparty: roles.iAmCounterparty,
    myAcceptedCurrentRevision,
    rolesValid: roles.rolesValid,
    proposerId: roles.proposerId,
    counterpartyId: roles.counterpartyId,
    canAccept,
    canDecline,
    waitingForOther,
    waitingForRole,
    waitingLabel,
    bothAcceptedLabel,
    viewerRoleLabel,
    needsRoleRevision,
  };
}
