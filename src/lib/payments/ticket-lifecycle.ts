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
  "EXPIRED",
] as const;

/**
 * Unfunded terminal statuses removed from the normal chat timeline.
 * Funded / refunded / disputed tickets stay as permanent financial history.
 */
export const UNFUNDED_HIDDEN_CHAT_STATUSES = [
  "CANCELLED",
  "DECLINED",
  "SUPERSEDED",
  "VOIDED",
  "DELETED",
  "EXPIRED",
] as const;

/** Accept/fund must reject these ticket statuses. */
export const TICKET_STATUSES_BLOCK_ACCEPT = [
  "CANCELLED",
  "DECLINED",
  "SUPERSEDED",
  "VOIDED",
  "DELETED",
  "FUNDED",
  "REFUNDED",
  "EXPIRED",
] as const;

const MONEY_KEEP_CHAT_PT_STATUSES = [
  "FUNDED",
  "PROCUREMENT_RELEASED",
  "AWAITING_SHIPMENT",
  "IN_TRANSIT",
  "DELIVERED",
  "IN_INSPECTION",
  "READY_TO_RELEASE",
  "RELEASED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "DISPUTED",
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
  "EXPIRED",
] as const;

/** Unfunded tickets with no meaningful activity expire after this window. */
export const UNFUNDED_TICKET_INACTIVITY_MS = 72 * 60 * 60 * 1000;

/** Stripe PI states that must be reconciled before unfunded expiry. */
export const PAYMENT_INTENT_STATUSES_BLOCK_EXPIRY = [
  "processing",
  "requires_action",
  "requires_capture",
  "succeeded",
] as const;

/**
 * Derive a single display / gating lifecycle stage from PaymentTicket +
 * ProtectedTransaction. COMPLETED is the RELEASED terminal stage.
 */
export function resolveLifecycleStage(
  ticketStatus: string,
  protectedStatus: string | null,
  procReleased: boolean,
  deliveredAt?: Date | string | null,
): string {
  if (
    ticketStatus === "DECLINED" ||
    ticketStatus === "SUPERSEDED" ||
    ticketStatus === "CANCELLED" ||
    ticketStatus === "DELETED" ||
    ticketStatus === "VOIDED" ||
    ticketStatus === "EXPIRED"
  ) {
    return ticketStatus;
  }
  const st = protectedStatus || ticketStatus;
  if (st === "RELEASED") return "COMPLETED";
  if (st === "REFUNDED" || st === "PARTIALLY_REFUNDED") return st;
  if (st === "DISPUTED") return "DISPUTED";
  if (["IN_INSPECTION", "READY_TO_RELEASE"].includes(st)) return st;
  if (st === "DELIVERED" && deliveredAt) return "ITEM_RECEIVED";
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
      return "ITEM SHIPPED";
    case "DELIVERED":
      return "AWAITING BUYER";
    case "ITEM_RECEIVED":
      return "ITEM RECEIVED";
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
    case "EXPIRED":
      return "EXPIRED";
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
  hiddenFromChatAt?: Date | string | null;
}): boolean {
  if (opts.hiddenFromChatAt) return false;
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
    ticketStatus === "VOIDED" ||
    ticketStatus === "EXPIRED"
  );
}

/**
 * Whether this ticket belongs in the normal conversation timeline.
 * ACTIVE unfunded (PROPOSED / ACCEPTED) stay. Unfunded CANCELLED / DECLINED /
 * SUPERSEDED / VOIDED / EXPIRED are removed (DB rows kept). Real money history stays.
 */
export function ticketAppearsInChatTimeline(opts: {
  ticketStatus: string;
  protectedStatus?: string | null;
  fundedAt?: Date | string | null;
  involvesMoney?: boolean;
  hiddenFromChatAt?: Date | string | null;
}): boolean {
  if (opts.hiddenFromChatAt) return false;
  const st = opts.ticketStatus;
  if (
    !(UNFUNDED_HIDDEN_CHAT_STATUSES as readonly string[]).includes(st)
  ) {
    return true;
  }
  if (opts.involvesMoney) return true;
  if (opts.fundedAt) return true;
  const pst = opts.protectedStatus || "";
  return (MONEY_KEEP_CHAT_PT_STATUSES as readonly string[]).includes(pst);
}

/**
 * Authoritative Accept visibility (PART 9).
 * viewerMayAccept = active unfunded AND participant AND not proposer
 * AND has not accepted the current revision.
 */
export function viewerMayAcceptTicket(opts: {
  status: string;
  viewerId: string;
  createdById?: string | null;
  buyerId: string;
  sellerId: string;
  revision: number;
  buyerApprovedRevision?: number | null;
  sellerApprovedRevision?: number | null;
}): boolean {
  const viewerId = (opts.viewerId || "").trim();
  const createdById = (opts.createdById || "").trim();
  const buyerId = (opts.buyerId || "").trim();
  const sellerId = (opts.sellerId || "").trim();
  const activeUnfunded =
    opts.status === "PROPOSED" || opts.status === "DRAFT";
  if (!viewerId || !activeUnfunded) return false;
  if ((TICKET_STATUSES_BLOCK_ACCEPT as readonly string[]).includes(opts.status)) {
    return false;
  }
  const isParty = viewerId === buyerId || viewerId === sellerId;
  if (!isParty) return false;
  if (createdById && viewerId === createdById) return false;
  const mine =
    viewerId === buyerId
      ? partyAcceptedCurrentRevision(opts.buyerApprovedRevision, opts.revision)
      : partyAcceptedCurrentRevision(opts.sellerApprovedRevision, opts.revision);
  return !mine;
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
    case "EXPIRED":
      return "Payment agreement expired";
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

/** Protected / ticket states that mean funding already happened or is in flight. */
export const PAY_BLOCKING_PT_STATUSES = [
  "FUNDED",
  "PROCUREMENT_RELEASED",
  "AWAITING_SHIPMENT",
  "IN_TRANSIT",
  "DELIVERED",
  "IN_INSPECTION",
  "READY_TO_RELEASE",
  "RELEASED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "DISPUTED",
  "CANCELLED",
  "FAILED",
] as const;

const PAY_BLOCKING_LIFECYCLE_STAGES = [
  "FUNDED",
  "ITEM_FUNDS_RELEASED",
  "AWAITING_SHIPMENT",
  "IN_TRANSIT",
  "DELIVERED",
  "ITEM_RECEIVED",
  "IN_INSPECTION",
  "READY_TO_RELEASE",
  "COMPLETED",
  "RELEASED",
  "DISPUTED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
] as const;

/**
 * Authoritative Pay UI gate. Pay only while accepted, unfunded, and the PI
 * has not already succeeded / started processing as funded.
 */
export function ticketMayShowPayUi(opts: {
  ticketStatus: string;
  protectedStatus?: string | null;
  fundedAt?: Date | string | null;
  paymentIntentStatus?: string | null;
  lifecycleStage?: string | null;
}): boolean {
  if (isInactiveTicketStatus(opts.ticketStatus)) return false;
  if (opts.ticketStatus === "FUNDED") return false;
  if (opts.fundedAt) return false;
  const pst = (opts.protectedStatus || "").trim();
  if ((PAY_BLOCKING_PT_STATUSES as readonly string[]).includes(pst)) {
    return false;
  }
  const pi = (opts.paymentIntentStatus || "").trim();
  if (pi === "succeeded" || pi === "processing") return false;
  const stage =
    opts.lifecycleStage ||
    resolveLifecycleStage(
      opts.ticketStatus,
      opts.protectedStatus ?? null,
      false,
    );
  if ((PAY_BLOCKING_LIFECYCLE_STAGES as readonly string[]).includes(stage)) {
    return false;
  }
  if (isTerminalLifecycleStage(stage)) return false;
  return (
    opts.ticketStatus === "ACCEPTED" ||
    stage === "AGREED_AWAITING_PAYMENT" ||
    pst === "ACCEPTED" ||
    pst === "AWAITING_PAYMENT"
  );
}

/** Seller-side Stripe destination / entitlement always follows sellerId (sourcer). */
export function sellerDestinationUserId(opts: {
  sellerId: string;
  proposerId?: string | null;
  buyerId?: string | null;
}): string {
  return (opts.sellerId || "").trim();
}

/** Stripe-confirmed transfer readiness for that seller only — never another user's account. */
export function isSellerConnectTransferReady(opts: {
  stripeAccountId?: string | null;
  chargesEnabled?: boolean | null;
  payoutsEnabled?: boolean | null;
}): boolean {
  return Boolean(
    (opts.stripeAccountId || "").trim() &&
      opts.chargesEnabled &&
      opts.payoutsEnabled,
  );
}

/**
 * Unfunded stale tickets expire. Funded / processing payments never expire by age.
 */
export function unfundedTicketShouldExpire(opts: {
  ticketStatus: string;
  lastMeaningfulActivityAt?: Date | string | null;
  involvesMoney?: boolean;
  fundedAt?: Date | string | null;
  paymentIntentStatus?: string | null;
  now?: Date | number;
}): boolean {
  const status = (opts.ticketStatus || "").trim();
  if (!status) return false;
  if (isInactiveTicketStatus(status)) return false;
  if (status === "FUNDED") return false;
  if (opts.involvesMoney) return false;
  if (opts.fundedAt) return false;
  const pi = (opts.paymentIntentStatus || "").trim();
  if (
    pi &&
    (PAYMENT_INTENT_STATUSES_BLOCK_EXPIRY as readonly string[]).includes(pi)
  ) {
    return false;
  }
  const raw = opts.lastMeaningfulActivityAt;
  if (!raw) return false;
  const activity =
    raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  if (!Number.isFinite(activity)) return false;
  const now =
    opts.now instanceof Date
      ? opts.now.getTime()
      : typeof opts.now === "number"
        ? opts.now
        : Date.now();
  return now - activity >= UNFUNDED_TICKET_INACTIVITY_MS;
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
  const isParty =
    Boolean(viewerId) && (viewerId === buyerId || viewerId === sellerId);
  // Counterparty = party who is NOT the proposer. Independent of Buyer/Sourcer.
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
    iAmProposer: Boolean(viewerId) && Boolean(proposerId) && viewerId === proposerId,
    iAmCounterparty: Boolean(
      viewerId && proposerId && isParty && viewerId !== proposerId,
    ),
    iAmBuyer: Boolean(viewerId) && viewerId === buyerId,
    iAmSeller: Boolean(viewerId) && viewerId === sellerId,
  };
}

/**
 * Canonical Payment Ticket viewer = this request's authenticated User.id.
 * Conversation/ticket GET `viewerUserId` (cookie session) always wins.
 * Never prefer a cached /api/auth/me id: both parties are on the ticket, so a
 * stale proposer identity would hide Accept for the real counterparty.
 */
export function resolveAuthoritativeViewerId(opts: {
  conversationSessionUserId?: string | null;
  accountId?: string | null;
  ticketViewerId?: string | null;
  buyerId: string;
  sellerId: string;
}): string {
  const fromConversation = (opts.conversationSessionUserId || "").trim();
  if (fromConversation) return fromConversation;
  const accountId = (opts.accountId || "").trim();
  const ticketViewerId = (opts.ticketViewerId || "").trim();
  const buyerId = (opts.buyerId || "").trim();
  const sellerId = (opts.sellerId || "").trim();
  const accountIsParty =
    Boolean(accountId) && (accountId === buyerId || accountId === sellerId);
  if (accountIsParty) return accountId;
  const ticketIsParty =
    Boolean(ticketViewerId) &&
    (ticketViewerId === buyerId || ticketViewerId === sellerId);
  if (ticketIsParty) return ticketViewerId;
  return accountId || ticketViewerId;
}

export function normalizePartyHandle(raw?: string | null): string {
  return (raw || "").trim().replace(/^@+/, "").toLowerCase();
}

/** True when waiting copy would tell the current viewer to wait for themselves. */
export function waitingCopyAddressesViewer(opts: {
  waitingLabel?: string | null;
  viewerUsername?: string | null;
  viewerId?: string | null;
  waitForId?: string | null;
}): boolean {
  const viewerId = (opts.viewerId || "").trim();
  const waitForId = (opts.waitForId || "").trim();
  if (viewerId && waitForId && viewerId === waitForId) return true;
  const handle = normalizePartyHandle(opts.viewerUsername);
  const label = (opts.waitingLabel || "").toLowerCase();
  if (!handle || !label) return false;
  return (
    label.includes(`waiting for @${handle} to accept`) ||
    label.includes(`waiting for ${handle} to accept`)
  );
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
  /** Alias of canAccept — single Accept-visibility rule. */
  viewerMayAccept: boolean;
  /** Alias of canAccept — render Accept/Decline when true. */
  shouldShowAcceptCTA: boolean;
  viewerIsProposer: boolean;
  viewerIsBuyer: boolean;
  viewerIsSourcer: boolean;
  viewerIsCounterparty: boolean;
  viewerAcceptedCurrentRevision: boolean;
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
  /** @deprecated wait-for name is derived from createdBy vs buyer/seller usernames. */
  counterpartyUsername?: string | null;
  buyerUsername?: string | null;
  sellerUsername?: string | null;
  viewerUsername?: string | null;
}): TicketAcceptanceState {
  const roles = resolveTicketRoleModel({
    createdById: opts.createdById,
    buyerId: opts.buyerId,
    sellerId: opts.sellerId,
    viewerId: opts.viewerId,
  });
  const viewerId = (opts.viewerId || "").trim();
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
  const terminalUnfunded = isInactiveTicketStatus(opts.status);

  const waitForId = roles.counterpartyId;
  const waitForUsername =
    waitForId && waitForId === roles.buyerId
      ? opts.buyerUsername
      : waitForId && waitForId === roles.sellerId
        ? opts.sellerUsername
        : opts.counterpartyUsername;
  const waitingForRole: "buyer" | "seller" | null =
    waitForId === roles.buyerId
      ? "buyer"
      : waitForId === roles.sellerId
        ? "seller"
        : null;
  const waitHandle = normalizePartyHandle(waitForUsername);
  const otherName = waitHandle
    ? `@${waitHandle}`
    : waitingForRole === "seller"
      ? "the sourcer"
      : waitingForRole === "buyer"
        ? "the buyer"
        : "the other participant";
  const rawWaitingLabel = `Proposal sent. Waiting for ${otherName} to accept.`;
  const wouldWaitForSelf = waitingCopyAddressesViewer({
    waitingLabel: rawWaitingLabel,
    viewerUsername: opts.viewerUsername,
    viewerId,
    waitForId,
  });

  let canAccept = viewerMayAcceptTicket({
    status: opts.status,
    viewerId,
    createdById: roles.proposerId,
    buyerId: roles.buyerId,
    sellerId: roles.sellerId,
    revision: opts.revision,
    buyerApprovedRevision: opts.buyerApprovedRevision,
    sellerApprovedRevision: opts.sellerApprovedRevision,
  });
  let waitingForOther =
    roles.rolesValid &&
    roles.iAmProposer &&
    openForAccept &&
    myAcceptedCurrentRevision &&
    !bothAcceptedCurrentRevision &&
    !wouldWaitForSelf &&
    !terminalUnfunded;

  // Never render proposer waiting copy that names the current viewer.
  if (wouldWaitForSelf) {
    waitingForOther = false;
    if (
      openForAccept &&
      isParty &&
      !myAcceptedCurrentRevision &&
      !bothAcceptedCurrentRevision
    ) {
      canAccept = true;
    }
  }

  if (terminalUnfunded) {
    canAccept = false;
    waitingForOther = false;
  }

  const canDecline = canAccept;
  const waitingLabel = waitingForOther ? rawWaitingLabel : null;
  // Never show dual-accept copy on a terminal/cancelled ticket, even if
  // leftover approval columns still match the last revision.
  const bothAcceptedLabel =
    bothAcceptedCurrentRevision && !terminalUnfunded
      ? "Agreement accepted by both parties"
      : null;
  const viewerRoleLabel: "buyer" | "sourcer" | null = roles.iAmBuyer
    ? "buyer"
    : roles.iAmSeller
      ? "sourcer"
      : null;
  const needsRoleRevision =
    openForAccept &&
    Boolean(roles.proposerId) &&
    !roles.rolesValid;

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
    viewerMayAccept: canAccept,
    shouldShowAcceptCTA: canAccept,
    viewerIsProposer: roles.iAmProposer,
    viewerIsBuyer: roles.iAmBuyer,
    viewerIsSourcer: roles.iAmSeller,
    viewerIsCounterparty: roles.iAmCounterparty,
    viewerAcceptedCurrentRevision: myAcceptedCurrentRevision,
    canDecline,
    waitingForOther,
    waitingForRole,
    waitingLabel,
    bothAcceptedLabel,
    viewerRoleLabel,
    needsRoleRevision,
  };
}

export type PaymentTicketActionInput = {
  status: string;
  createdById?: string | null;
  buyerId: string;
  sellerId: string;
  revision: number;
  buyerApprovedRevision?: number | null;
  sellerApprovedRevision?: number | null;
  protectedTransactionId?: string | null;
  protectedStatus?: string | null;
  fundedAt?: Date | string | null;
  paymentIntentStatus?: string | null;
  lifecycleStage?: string | null;
  buyerUsername?: string | null;
  sellerUsername?: string | null;
  viewerUsername?: string | null;
};

/**
 * Role-neutral ticket + current session user → actions.
 * Never persist ticket.viewer; always evaluate fresh for this session.
 */
export function getPaymentTicketActions(
  ticket: PaymentTicketActionInput,
  currentSessionUserId: string,
) {
  const acceptance = deriveTicketAcceptanceState({
    viewerId: currentSessionUserId,
    createdById: ticket.createdById,
    buyerId: ticket.buyerId,
    sellerId: ticket.sellerId,
    revision: ticket.revision,
    buyerApprovedRevision: ticket.buyerApprovedRevision,
    sellerApprovedRevision: ticket.sellerApprovedRevision,
    status: ticket.status,
    buyerUsername: ticket.buyerUsername,
    sellerUsername: ticket.sellerUsername,
    viewerUsername: ticket.viewerUsername,
  });
  const canPay =
    Boolean(ticket.protectedTransactionId) &&
    ticketMayShowPayUi({
      ticketStatus: ticket.status,
      protectedStatus: ticket.protectedStatus,
      fundedAt: ticket.fundedAt,
      paymentIntentStatus: ticket.paymentIntentStatus,
      lifecycleStage: ticket.lifecycleStage,
    }) &&
    viewerMayFundTicket({
      viewerId: currentSessionUserId,
      buyerId: ticket.buyerId,
    });
  return {
    canAccept: acceptance.viewerMayAccept,
    canDecline: acceptance.canDecline,
    canPay,
    viewerMayAccept: acceptance.viewerMayAccept,
    shouldShowAcceptCTA: acceptance.shouldShowAcceptCTA,
    acceptance,
  };
}
