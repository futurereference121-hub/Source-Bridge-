import { prisma } from "@/lib/db";
import {
  calculateFees,
  procurementAdvanceAmount,
} from "@/lib/payments/fees";
import { getPlatformPaymentConfig, assertCurrencyAllowed } from "@/lib/payments/config";
import {
  assertEligiblePaymentParty,
  assertNotSelfTrade,
  isProcurementEligible,
  type PartyUser,
} from "@/lib/payments/eligibility";
import { assertPaymentsTestAllowlisted } from "@/lib/payments/allowlist";
import {
  getStripeMode,
  isDirectPaymentsEnabled,
  isProcurementAdvancesEnabled,
  isProtectedPaymentsEnabled,
} from "@/lib/payments/flags";
import { recordAuditEvent } from "@/lib/payments/ledger";
import { normalizeCurrency, totalChargeMinor } from "@/lib/payments/money";
import { hashTerms, type CanonicalTerms } from "@/lib/payments/terms";
import { releaseListingReservation } from "@/lib/payments/listing-lifecycle";
import {
  isDirectPaymentOption,
  normalizeTxnPaymentOption,
  type TxnPaymentOptionInput,
} from "@/lib/payments/payment-option";
import { computeProtectedFinancials } from "@/lib/payments/breakdown";
import {
  buyerCanConfirmReceipt,
  buyerCanReleaseNow,
  buyerCanReportIssue,
  sellerCanAddTracking,
} from "@/lib/payments/fulfilment";
import {
  mapMessage,
  participantUserSelect,
} from "@/lib/messaging";
import {
  ACTIVE_TICKET_STATUSES,
  deriveTicketAcceptanceState,
  isActiveLifecycleTicket,
  lifecycleLabel,
  MAX_ACTIVE_PAYMENT_TICKETS,
  resolveLifecycleStage,
  resolveTicketRoleModel,
  ticketAppearsInChatTimeline,
  TICKET_STATUSES_BLOCK_ACCEPT,
  UNFUNDED_TICKET_INACTIVITY_MS,
  unfundedTicketShouldExpire,
  viewerMayFundTicket,
  ticketMayShowPayUi,
} from "@/lib/payments/ticket-lifecycle";
import { getStripe, isStripeConfigured } from "@/lib/payments/stripe/client";

export {
  ACTIVE_TICKET_STATUSES,
  INACTIVE_TICKET_STATUSES,
  assignConversationTicketRoles,
  deriveTicketAcceptanceState,
  getPaymentTicketActions,
  isActiveLifecycleTicket,
  isActiveTicketStatus,
  isInactiveTicketStatus,
  isTerminalLifecycleStage,
  lifecycleLabel,
  MAX_ACTIVE_PAYMENT_TICKETS,
  resolveLifecycleStage,
  resolveTicketRoleModel,
  resolveAuthoritativeViewerId,
  sellerDestinationUserId,
  isSellerConnectTransferReady,
  ticketAppearsInChatTimeline,
  TICKET_STATUSES_BLOCK_ACCEPT,
  UNFUNDED_TICKET_INACTIVITY_MS,
  unfundedTicketShouldExpire,
  viewerMayAcceptTicket,
  waitingCopyAddressesViewer,
  isSubtleHistoricalTicket,
  isCompletedLifecycleTicket,
  subtleHistoricalLabel,
  viewerMayFundTicket,
  ticketMayShowPayUi,
} from "@/lib/payments/ticket-lifecycle";

/** Protected txn statuses that mean money has, is, or may still be in flight. */
const MONEY_TXN_STATUSES = [
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

/** Protected txn statuses still in flight (historical RELEASED/REFUNDED/CANCELLED OK for SR concurrency). */
const ACTIVE_TXN_STATUSES = [
  "DRAFT",
  "AWAITING_ACCEPTANCE",
  "ACCEPTED",
  "AWAITING_PAYMENT",
  "FUNDED",
  "PROCUREMENT_RELEASED",
  "AWAITING_SHIPMENT",
  "IN_TRANSIT",
  "DELIVERED",
  "IN_INSPECTION",
  "READY_TO_RELEASE",
  "DISPUTED",
] as const;

type FundingGuardInputs = {
  ticketStatus: string;
  protectedTxn?: {
    status: string;
    fundedAt: Date | string | null;
    stripePaymentIntentId?: string | null;
    procurementTransferredMinor?: number;
    finalTransferredMinor?: number;
    refundedMinor?: number;
  } | null;
};

/**
 * True when the ticket/PT has any funding or payment ambiguity.
 * Reject edit/cancel/delete that would destroy financial state.
 *
 * Unfunded domain states (ACCEPTED / AWAITING_PAYMENT without fundedAt /
 * transfers / refunds) are NOT money — even if a Stripe PaymentIntent id
 * was created during checkout startup. Those can be cancelled / superseded.
 * True captures (fundedAt, money statuses, transfers, refunds) always block.
 */
export function ticketInvolvesMoney(input: FundingGuardInputs): boolean {
  if (input.ticketStatus === "FUNDED") return true;
  const pt = input.protectedTxn;
  if (!pt) return false;
  if (pt.fundedAt) return true;
  if ((pt.procurementTransferredMinor ?? 0) > 0) return true;
  if ((pt.finalTransferredMinor ?? 0) > 0) return true;
  if ((pt.refundedMinor ?? 0) > 0) return true;
  if ((MONEY_TXN_STATUSES as readonly string[]).includes(pt.status)) return true;
  // PI present but domain still pre-fund and non-money status is OK for cancel/edit.
  // PI + unexpected status (or unknown) → treat as ambiguous money risk.
  const unfundedOpen = [
    "ACCEPTED",
    "AWAITING_PAYMENT",
    "DRAFT",
    "AWAITING_ACCEPTANCE",
    "CANCELLED",
  ];
  if (
    (pt.stripePaymentIntentId || "").trim().length > 0 &&
    !unfundedOpen.includes(pt.status)
  ) {
    return true;
  }
  return false;
}

/**
 * Lifecycle actions for a party viewing a ticket.
 * - PROPOSED (never dual-accepted): edit + safe delete
 * - ACCEPTED unfunded: edit (supersede) + cancel agreement
 * - FUNDED / money: none of the above
 */
export function computeTicketLifecycleActions(opts: {
  status: string;
  viewerId: string;
  buyerId: string;
  sellerId: string;
  involvesMoney: boolean;
}): { canEdit: boolean; canCancel: boolean; canDelete: boolean } {
  const isParty =
    opts.viewerId === opts.buyerId || opts.viewerId === opts.sellerId;
  if (!isParty || opts.involvesMoney) {
    return { canEdit: false, canCancel: false, canDelete: false };
  }
  if (opts.status === "PROPOSED") {
    return { canEdit: true, canCancel: false, canDelete: true };
  }
  if (opts.status === "ACCEPTED") {
    return { canEdit: true, canCancel: true, canDelete: false };
  }
  if (opts.status === "DRAFT") {
    return { canEdit: true, canCancel: false, canDelete: true };
  }
  return { canEdit: false, canCancel: false, canDelete: false };
}

export type TicketAmountsInput = {
  itemCostMinor: number;
  shippingMinor?: number;
  sellerServiceFeeMinor?: number;
  title?: string;
  notes?: string;
  /** PROTECTED | INSTANT | DIRECT (DIRECT stores as INSTANT). */
  paymentOption?: TxnPaymentOptionInput;
  procurementAdvanceAgreed?: boolean;
  listingId?: string | null;
  currency?: string;
};

type TicketPartyUser = {
  id: string;
  name: string;
  username: string | null;
};

async function loadRoleParties(
  buyerId: string,
  sellerId: string,
  createdById?: string | null,
): Promise<{
  buyerParty: TicketPartyUser | null;
  sellerParty: TicketPartyUser | null;
  proposedBy: TicketPartyUser | null;
}> {
  const ids = [...new Set([buyerId, sellerId, createdById || ""].filter(Boolean))];
  if (ids.length === 0) {
    return { buyerParty: null, sellerParty: null, proposedBy: null };
  }
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, username: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return {
    buyerParty: byId.get(buyerId) ?? null,
    sellerParty: byId.get(sellerId) ?? null,
    proposedBy: createdById ? byId.get(createdById) ?? null : null,
  };
}

function mapTicket(
  t: {
    id: string;
    conversationId: string;
    createdById: string;
    buyerId: string;
    sellerId: string;
    listingId: string | null;
    sourcingRequestId?: string | null;
    status: string;
    revision: number;
    termsHash: string;
    title: string;
    currency: string;
    itemCostMinor: number;
    shippingMinor: number;
    sellerServiceFeeMinor: number;
    protectionFeeMinor: number;
    totalChargeMinor: number;
    paymentOption: string;
    procurementAdvanceAgreed: boolean;
    procurementAdvanceMinor: number;
    notes: string;
    buyerApprovedRevision: number | null;
    sellerApprovedRevision: number | null;
    buyerApprovedAt: Date | null;
    sellerApprovedAt: Date | null;
    declinedById: string | null;
    declinedAt: Date | null;
    declineReason: string;
    protectedTransactionId: string | null;
    stripeMode: string;
    createdAt: Date;
    updatedAt: Date;
    lastMeaningfulActivityAt?: Date;
    hiddenFromChatAt?: Date | null;
  },
  extras?: {
    protectedTxnStatus?: string | null;
    procurementTransferredMinor?: number;
    finalTransferredMinor?: number;
    refundedMinor?: number;
    procurementAdvancesFlag?: boolean;
    trackingNumber?: string | null;
    trackingCarrier?: string | null;
    shippedAt?: Date | string | null;
    deliveredAt?: Date | string | null;
    inspectionEndsAt?: Date | string | null;
    fundedAt?: Date | string | null;
    paymentIntentStatus?: string | null;
    proposedBy?: {
      id: string;
      name: string;
      username: string | null;
    } | null;
    buyerParty?: {
      id: string;
      name: string;
      username: string | null;
    } | null;
    sellerParty?: {
      id: string;
      name: string;
      username: string | null;
    } | null;
    viewerId?: string | null;
    viewerUsername?: string | null;
    involvesMoney?: boolean;
    sellerConnectReady?: boolean;
    sellerConnectHasAccount?: boolean;
  },
) {
  const books = computeProtectedFinancials({
    itemCostMinor: t.itemCostMinor,
    shippingMinor: t.shippingMinor,
    sellerServiceFeeMinor: t.sellerServiceFeeMinor,
    protectionFeeMinor: t.protectionFeeMinor,
    totalChargeMinor: t.totalChargeMinor,
    procurementAdvanceAgreed: t.procurementAdvanceAgreed,
    procurementAdvanceMinor: t.procurementAdvanceMinor,
    procurementTransferredMinor: extras?.procurementTransferredMinor ?? 0,
    finalTransferredMinor: extras?.finalTransferredMinor ?? 0,
    refundedMinor: extras?.refundedMinor ?? 0,
  });
  const protectedStatus = extras?.protectedTxnStatus ?? null;
  const procPending =
    Boolean(extras?.procurementAdvancesFlag) &&
    t.procurementAdvanceAgreed &&
    t.procurementAdvanceMinor > 0 &&
    t.paymentOption === "PROTECTED" &&
    (t.status === "FUNDED" || protectedStatus === "FUNDED") &&
    (extras?.procurementTransferredMinor ?? 0) === 0;
  const procReleased =
    (extras?.procurementTransferredMinor ?? 0) > 0 ||
    protectedStatus === "PROCUREMENT_RELEASED";
  const lifecycleStage = resolveLifecycleStage(
    t.status,
    protectedStatus,
    procReleased,
    extras?.deliveredAt ?? null,
  );

  const involvesMoney =
    extras?.involvesMoney ??
    ticketInvolvesMoney({
      ticketStatus: t.status,
      protectedTxn: extras
        ? {
            status: protectedStatus || "",
            fundedAt: extras.fundedAt ?? null,
            // mapTicket often lacks PI/fundedAt — GET path passes involvesMoney
            procurementTransferredMinor: extras.procurementTransferredMinor,
            finalTransferredMinor: extras.finalTransferredMinor,
            refundedMinor: extras.refundedMinor,
          }
        : null,
    });

  const lifecycle =
    extras?.viewerId
      ? computeTicketLifecycleActions({
          status: t.status,
          viewerId: extras.viewerId,
          buyerId: t.buyerId,
          sellerId: t.sellerId,
          involvesMoney,
        })
      : { canEdit: false, canCancel: false, canDelete: false };

  const trackingNumber = extras?.trackingNumber || "";
  const trackingCarrier = extras?.trackingCarrier || "";
  const shippedAtIso =
    extras?.shippedAt instanceof Date
      ? extras.shippedAt.toISOString()
      : extras?.shippedAt
        ? String(extras.shippedAt)
        : null;
  const deliveredAtIso =
    extras?.deliveredAt instanceof Date
      ? extras.deliveredAt.toISOString()
      : extras?.deliveredAt
        ? String(extras.deliveredAt)
        : null;
  const inspectionEndsAtIso =
    extras?.inspectionEndsAt instanceof Date
      ? extras.inspectionEndsAt.toISOString()
      : extras?.inspectionEndsAt
        ? String(extras.inspectionEndsAt)
        : null;
  const shipped = Boolean(shippedAtIso || trackingNumber);
  const ptStatus = protectedStatus || "";
  const canMarkShipped =
    Boolean(extras?.viewerId && extras.viewerId === t.sellerId) &&
    !isDirectPaymentOption(t.paymentOption) &&
    sellerCanAddTracking({
      paymentOption: t.paymentOption,
      status: ptStatus || t.status,
      trackingNumber,
      procurementAdvanceAgreed: t.procurementAdvanceAgreed,
      procurementAdvanceMinor: t.procurementAdvanceMinor,
      procurementTransferredMinor: extras?.procurementTransferredMinor,
    });
  const canConfirmReceipt =
    Boolean(extras?.viewerId && extras.viewerId === t.buyerId) &&
    buyerCanConfirmReceipt({
      paymentOption: t.paymentOption,
      status: ptStatus,
      shipped,
      deliveredAt: deliveredAtIso,
    });
  const canReleaseNow =
    Boolean(extras?.viewerId && extras.viewerId === t.buyerId) &&
    buyerCanReleaseNow({
      paymentOption: t.paymentOption,
      status: ptStatus,
      shipped,
      deliveredAt: deliveredAtIso,
    });
  const canReportIssue =
    Boolean(extras?.viewerId && extras.viewerId === t.buyerId) &&
    buyerCanReportIssue({
      paymentOption: t.paymentOption,
      status: ptStatus,
      residualMinor: books.finalResidualMinor,
    });

  const acceptance = extras?.viewerId
    ? deriveTicketAcceptanceState({
        viewerId: extras.viewerId,
        createdById: t.createdById,
        buyerId: t.buyerId,
        sellerId: t.sellerId,
        revision: t.revision,
        buyerApprovedRevision: t.buyerApprovedRevision,
        sellerApprovedRevision: t.sellerApprovedRevision,
        status: t.status,
        buyerUsername: extras.buyerParty?.username,
        sellerUsername: extras.sellerParty?.username,
        viewerUsername:
          extras.viewerUsername ||
          (extras.viewerId === extras.buyerParty?.id
            ? extras.buyerParty?.username
            : extras.viewerId === extras.sellerParty?.id
              ? extras.sellerParty?.username
              : extras.proposedBy?.id === extras.viewerId
                ? extras.proposedBy?.username
                : null),
      })
    : null;
  return {
    id: t.id,
    conversationId: t.conversationId,
    createdById: t.createdById,
    proposedBy: extras?.proposedBy ?? null,
    buyerParty: extras?.buyerParty ?? null,
    sellerParty: extras?.sellerParty ?? null,
    buyerId: t.buyerId,
    sellerId: t.sellerId,
    listingId: t.listingId,
    sourcingRequestId: t.sourcingRequestId ?? null,
    status: t.status,
    revision: t.revision,
    termsHash: t.termsHash,
    title: t.title,
    currency: t.currency,
    itemCostMinor: t.itemCostMinor,
    shippingMinor: t.shippingMinor,
    sellerServiceFeeMinor: t.sellerServiceFeeMinor,
    protectionFeeMinor: t.protectionFeeMinor,
    totalChargeMinor: t.totalChargeMinor,
    paymentOption: t.paymentOption,
    procurementAdvanceAgreed: t.procurementAdvanceAgreed,
    procurementAdvanceMinor: t.procurementAdvanceMinor,
    notes: t.notes,
    buyerApprovedRevision: t.buyerApprovedRevision,
    sellerApprovedRevision: t.sellerApprovedRevision,
    buyerApprovedAt: t.buyerApprovedAt?.toISOString() ?? null,
    sellerApprovedAt: t.sellerApprovedAt?.toISOString() ?? null,
    declinedById: t.declinedById,
    declinedAt: t.declinedAt?.toISOString() ?? null,
    declineReason: t.declineReason,
    protectedTransactionId: t.protectedTransactionId,
    protectedTxnStatus: protectedStatus,
    stripeMode: t.stripeMode,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    lastMeaningfulActivityAt: (
      t.lastMeaningfulActivityAt || t.updatedAt
    ).toISOString(),
    hiddenFromChatAt: t.hiddenFromChatAt
      ? t.hiddenFromChatAt.toISOString()
      : null,
    paymentIntentStatus: extras?.paymentIntentStatus ?? null,
    fundedAt: extras?.fundedAt
      ? extras.fundedAt instanceof Date
        ? extras.fundedAt.toISOString()
        : String(extras.fundedAt)
      : null,
    sellerConnect: {
      ready: Boolean(extras?.sellerConnectReady),
      hasAccount: Boolean(extras?.sellerConnectHasAccount),
    },
    lifecycleStage,
    lifecycleLabel: lifecycleLabel(lifecycleStage),
    trackingNumber,
    trackingCarrier,
    shippedAt: shippedAtIso,
    deliveredAt: deliveredAtIso,
    inspectionEndsAt: inspectionEndsAtIso,
    books,
    actions: {
      canReleaseProcurement: procPending,
      canPay:
        ticketMayShowPayUi({
          ticketStatus: t.status,
          protectedStatus: protectedStatus,
          fundedAt: extras?.fundedAt ?? null,
          paymentIntentStatus: extras?.paymentIntentStatus ?? null,
          lifecycleStage,
        }) &&
        Boolean(t.protectedTransactionId) &&
        viewerMayFundTicket({
          viewerId: extras?.viewerId || "",
          buyerId: t.buyerId,
        }) &&
        Boolean(extras?.sellerConnectReady),
      canAccept: acceptance?.canAccept ?? false,
      canEdit: lifecycle.canEdit,
      canCancel: lifecycle.canCancel,
      canDelete: lifecycle.canDelete,
      canMarkShipped,
      canAddTracking: canMarkShipped,
      canConfirmReceipt,
      canReleaseNow,
      canReportIssue,
    },
    breakdown: {
      itemCost: t.itemCostMinor,
      shipping: t.shippingMinor,
      sellerServiceFee: t.sellerServiceFeeMinor,
      sourceBridgeProtectionFee: t.protectionFeeMinor,
      total: t.totalChargeMinor,
      labels: {
        itemCost: books.labels.itemCost,
        shipping: books.labels.shipping,
        sellerServiceFee: books.labels.sellerServiceFee,
        sourceBridgeProtectionFee: books.labels.platformFee,
      },
      /** Shown before accept when procurement advance is agreed. */
      releaseStructure:
        t.procurementAdvanceAgreed && books.procurementAdvanceMinor > 0
          ? {
              itemFundsReleasedEarlyMinor: books.itemFundsReleasedEarlyMinor,
              remainingProtectedSellerShareMinor:
                books.remainingProtectedSellerShareMinor,
              platformFeeHeldMinor: books.platformFeeMinor,
              note: "Item funds may be released early after the buyer authorizes release. Remaining seller funds (shipping + sourcer fee) stay protected. Source Bridge fee is held separately.",
            }
          : null,
    },
    acceptance,
  };
}

async function extrasWithParties(
  t: { buyerId: string; sellerId: string; createdById: string },
  extras?: Parameters<typeof mapTicket>[1],
): Promise<NonNullable<Parameters<typeof mapTicket>[1]>> {
  const parties = await loadRoleParties(t.buyerId, t.sellerId, t.createdById);
  const connect = extras?.sellerConnectReady == null
    ? await prisma.stripeConnectAccount.findUnique({
        where: { userId: t.sellerId },
        select: {
          stripeAccountId: true,
          chargesEnabled: true,
          payoutsEnabled: true,
        },
      })
    : null;
  const sellerConnectReady =
    extras?.sellerConnectReady ??
    Boolean(
      connect?.stripeAccountId &&
        connect.chargesEnabled &&
        connect.payoutsEnabled,
    );
  const sellerConnectHasAccount =
    extras?.sellerConnectHasAccount ?? Boolean(connect?.stripeAccountId);
  return {
    ...parties,
    ...extras,
    proposedBy: extras?.proposedBy ?? parties.proposedBy,
    buyerParty: extras?.buyerParty ?? parties.buyerParty,
    sellerParty: extras?.sellerParty ?? parties.sellerParty,
    sellerConnectReady,
    sellerConnectHasAccount,
  };
}

/** PI status for unfunded checkout only — skip Stripe when already funded. */
async function peekOpenPaymentIntentStatus(opts: {
  stripePaymentIntentId?: string | null;
  fundedAt?: Date | string | null;
  protectedStatus?: string | null;
}): Promise<string | null> {
  if (opts.fundedAt) return null;
  const pst = (opts.protectedStatus || "").trim();
  if (
    pst &&
    [
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
    ].includes(pst)
  ) {
    return null;
  }
  const piId = (opts.stripePaymentIntentId || "").trim();
  if (!piId || !isStripeConfigured()) return null;
  try {
    const pi = await getStripe().paymentIntents.retrieve(piId);
    return pi.status || null;
  } catch {
    return null;
  }
}

async function loadProtectedTxnForGuard(protectedTransactionId: string | null) {
  if (!protectedTransactionId) return null;
  return prisma.protectedTransaction.findUnique({
    where: { id: protectedTransactionId },
    select: {
      id: true,
      status: true,
      fundedAt: true,
      stripePaymentIntentId: true,
      procurementTransferredMinor: true,
      finalTransferredMinor: true,
      refundedMinor: true,
      listingId: true,
      buyerId: true,
    },
  });
}

function assertNotFundedForMutation(
  ticketStatus: string,
  protectedTxn: Awaited<ReturnType<typeof loadProtectedTxnForGuard>>,
  action: string,
) {
  if (
    ticketInvolvesMoney({
      ticketStatus,
      protectedTxn,
    })
  ) {
    throw Object.assign(
      new Error(
        `Cannot ${action} a funded or in-progress Payment Ticket`,
      ),
      { status: 409, code: "TICKET_FUNDED" },
    );
  }
}

async function assertPartyToTicket(
  ticket: { buyerId: string; sellerId: string; conversationId: string },
  actorId: string,
) {
  if (actorId !== ticket.buyerId && actorId !== ticket.sellerId) {
    throw Object.assign(new Error("Not a party to this ticket"), { status: 403 });
  }
  const participant = await prisma.conversationParticipant.findUnique({
    where: {
      conversationId_userId: {
        conversationId: ticket.conversationId,
        userId: actorId,
      },
    },
    select: { leftAt: true },
  });
  if (!participant || participant.leftAt) {
    throw Object.assign(new Error("Not a party to this ticket"), { status: 403 });
  }
}

/**
 * Every Payment Ticket must appear in the conversation timeline as a
 * PAYMENT_TICKET message. Repairs orphan tickets (ticket row exists, no message)
 * so both parties always share the same chronological card.
 */
export async function ensureConversationPaymentTicketMessages(
  conversationId: string,
): Promise<number> {
  const tickets = await prisma.paymentTicket.findMany({
    where: { conversationId },
    select: {
      id: true,
      createdById: true,
      revision: true,
      createdAt: true,
      status: true,
      hiddenFromChatAt: true,
      protectedTransaction: {
        select: {
          status: true,
          fundedAt: true,
        },
      },
    },
  });
  if (tickets.length === 0) return 0;

  const visible = tickets.filter((t) =>
    ticketAppearsInChatTimeline({
      ticketStatus: t.status,
      protectedStatus: t.protectedTransaction?.status ?? null,
      fundedAt: t.protectedTransaction?.fundedAt ?? null,
      hiddenFromChatAt: t.hiddenFromChatAt ?? null,
    }),
  );
  if (visible.length === 0) return 0;

  // Any linked timeline row counts (not only PROPOSED) so we do not double-insert.
  const existing = await prisma.message.findMany({
    where: {
      conversationId,
      paymentTicketId: { in: visible.map((t) => t.id) },
    },
    select: { paymentTicketId: true },
  });
  const have = new Set(
    existing.map((m) => m.paymentTicketId).filter(Boolean) as string[],
  );

  let created = 0;
  for (const t of visible) {
    if (have.has(t.id)) continue;
    await prisma.message.create({
      data: {
        conversationId,
        senderId: t.createdById,
        body: `Payment Ticket v${t.revision} proposed — Protected by Source Bridge.`,
        messageType: "PAYMENT_TICKET",
        systemEventType: "PAYMENT_TICKET_PROPOSED",
        paymentTicketId: t.id,
        replyAllowed: true,
        // Preserve ticket chronology when backfilling missing timeline rows.
        createdAt: t.createdAt,
      },
    });
    created += 1;
  }
  return created;
}

/**
 * Authoritative Payment Tickets for a conversation (not solely via Message table).
 * Used to merge ticket cards into the chat timeline even if a marker Message is missing.
 * Includes ProtectedTransaction so lifecycleStage is COMPLETED when RELEASED.
 */
export async function expireStaleUnfundedTickets(opts?: {
  conversationId?: string;
  now?: Date;
  limit?: number;
}): Promise<{ expired: number; skippedProcessing: number }> {
  const now = opts?.now ?? new Date();
  const cutoff = new Date(now.getTime() - UNFUNDED_TICKET_INACTIVITY_MS);
  const candidates = await prisma.paymentTicket.findMany({
    where: {
      ...(opts?.conversationId ? { conversationId: opts.conversationId } : {}),
      status: { in: ["DRAFT", "PROPOSED", "ACCEPTED"] },
      lastMeaningfulActivityAt: { lte: cutoff },
    },
    include: {
      protectedTransaction: {
        select: {
          id: true,
          status: true,
          fundedAt: true,
          stripePaymentIntentId: true,
          procurementTransferredMinor: true,
          finalTransferredMinor: true,
          refundedMinor: true,
        },
      },
    },
    take: opts?.limit ?? 80,
    orderBy: { lastMeaningfulActivityAt: "asc" },
  });

  let expired = 0;
  let skippedProcessing = 0;
  const stripeReady = isStripeConfigured();
  const stripe = stripeReady ? getStripe() : null;

  for (const ticket of candidates) {
    const pt = ticket.protectedTransaction;
    const involvesMoney =
      Boolean(pt?.fundedAt) ||
      (pt?.procurementTransferredMinor ?? 0) > 0 ||
      (pt?.finalTransferredMinor ?? 0) > 0 ||
      (pt?.refundedMinor ?? 0) > 0 ||
      ticket.status === "FUNDED" ||
      (pt?.status
        ? [
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
          ].includes(pt.status)
        : false);

    let piStatus: string | null = null;
    const piId = (pt?.stripePaymentIntentId || "").trim();
    if (piId && stripe) {
      try {
        const pi = await stripe.paymentIntents.retrieve(piId);
        piStatus = pi.status;
      } catch {
        piStatus = null;
      }
    }

    if (
      !unfundedTicketShouldExpire({
        ticketStatus: ticket.status,
        lastMeaningfulActivityAt: ticket.lastMeaningfulActivityAt,
        involvesMoney,
        fundedAt: pt?.fundedAt ?? null,
        paymentIntentStatus: piStatus,
        now,
      })
    ) {
      if (
        piStatus &&
        ["processing", "requires_action", "requires_capture", "succeeded"].includes(
          piStatus,
        )
      ) {
        skippedProcessing += 1;
      }
      continue;
    }

    if (piId && stripe && piStatus && piStatus !== "canceled" && piStatus !== "succeeded") {
      try {
        await stripe.paymentIntents.cancel(piId);
      } catch {
        // If cancel races with a succeed/processing webhook, skip this ticket.
        skippedProcessing += 1;
        continue;
      }
    }

    await prisma.$transaction(async (tx) => {
      const fresh = await tx.paymentTicket.findUnique({
        where: { id: ticket.id },
        select: { status: true, protectedTransactionId: true },
      });
      if (!fresh || !["DRAFT", "PROPOSED", "ACCEPTED"].includes(fresh.status)) {
        return;
      }
      await tx.paymentTicket.update({
        where: { id: ticket.id },
        data: { status: "EXPIRED" },
      });
      if (fresh.protectedTransactionId) {
        const open = await tx.protectedTransaction.findUnique({
          where: { id: fresh.protectedTransactionId },
          select: { status: true, fundedAt: true },
        });
        if (
          open &&
          !open.fundedAt &&
          ["ACCEPTED", "AWAITING_PAYMENT", "DRAFT"].includes(open.status)
        ) {
          await tx.protectedTransaction.update({
            where: { id: fresh.protectedTransactionId },
            data: { status: "CANCELLED", cancelledAt: now },
          });
        }
      }
    });
    await recordAuditEvent({
      actorUserId: ticket.createdById,
      action: "PAYMENT_TICKET_EXPIRED",
      meta: { ticketId: ticket.id, conversationId: ticket.conversationId },
    });
    expired += 1;
  }
  return { expired, skippedProcessing };
}

export async function listConversationPaymentTickets(
  conversationId: string,
  viewerId?: string | null,
) {
  try {
    await expireStaleUnfundedTickets({ conversationId, limit: 20 });
  } catch (err) {
    console.error("[tickets:expire-lazy]", err);
  }
  const rows = await prisma.paymentTicket.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    include: {
      protectedTransaction: {
        select: {
          status: true,
          fundedAt: true,
          stripePaymentIntentId: true,
          procurementTransferredMinor: true,
          finalTransferredMinor: true,
          refundedMinor: true,
          trackingNumber: true,
          trackingCarrier: true,
          shippedAt: true,
          deliveredAt: true,
          inspectionEndsAt: true,
        },
      },
    },
  });
  const sellerIds = [...new Set(rows.map((r) => r.sellerId))];
  const connectRows =
    sellerIds.length === 0
      ? []
      : await prisma.stripeConnectAccount.findMany({
          where: { userId: { in: sellerIds } },
          select: {
            userId: true,
            stripeAccountId: true,
            chargesEnabled: true,
            payoutsEnabled: true,
          },
        });
  const connectBySeller = new Map(
    connectRows.map((c) => [
      c.userId,
      {
        ready: Boolean(c.stripeAccountId && c.chargesEnabled && c.payoutsEnabled),
        hasAccount: Boolean(c.stripeAccountId),
      },
    ]),
  );
  return rows
    .filter((t) =>
      ticketAppearsInChatTimeline({
        ticketStatus: t.status,
        protectedStatus: t.protectedTransaction?.status ?? null,
        fundedAt: t.protectedTransaction?.fundedAt ?? null,
        involvesMoney:
          (t.protectedTransaction?.procurementTransferredMinor ?? 0) > 0 ||
          (t.protectedTransaction?.finalTransferredMinor ?? 0) > 0 ||
          (t.protectedTransaction?.refundedMinor ?? 0) > 0,
        hiddenFromChatAt: t.hiddenFromChatAt ?? null,
      }),
    )
    .map((t) =>
    mapTicket(t, {
      protectedTxnStatus: t.protectedTransaction?.status ?? null,
      procurementTransferredMinor:
        t.protectedTransaction?.procurementTransferredMinor ?? 0,
      finalTransferredMinor:
        t.protectedTransaction?.finalTransferredMinor ?? 0,
      refundedMinor: t.protectedTransaction?.refundedMinor ?? 0,
      procurementAdvancesFlag: isProcurementAdvancesEnabled(),
      trackingNumber: t.protectedTransaction?.trackingNumber ?? "",
      trackingCarrier: t.protectedTransaction?.trackingCarrier ?? "",
      shippedAt: t.protectedTransaction?.shippedAt ?? null,
      deliveredAt: t.protectedTransaction?.deliveredAt ?? null,
      inspectionEndsAt: t.protectedTransaction?.inspectionEndsAt ?? null,
      fundedAt: t.protectedTransaction?.fundedAt ?? null,
      viewerId: viewerId || undefined,
      sellerConnectReady: connectBySeller.get(t.sellerId)?.ready ?? false,
      sellerConnectHasAccount: connectBySeller.get(t.sellerId)?.hasAccount ?? false,
    }),
  );
}

/**
 * Count active (non-terminal) Payment Tickets in a conversation using the
 * shared PaymentTicket + ProtectedTransaction lifecycle helper.
 */
export async function countActiveConversationTickets(
  conversationId: string,
  excludeTicketId?: string | null,
): Promise<number> {
  const rows = await prisma.paymentTicket.findMany({
    where: {
      conversationId,
      ...(excludeTicketId ? { id: { not: excludeTicketId } } : {}),
    },
    select: {
      id: true,
      status: true,
      hiddenFromChatAt: true,
      protectedTransaction: {
        select: {
          status: true,
          procurementTransferredMinor: true,
        },
      },
    },
  });
  let n = 0;
  for (const r of rows) {
    const procReleased =
      (r.protectedTransaction?.procurementTransferredMinor ?? 0) > 0 ||
      r.protectedTransaction?.status === "PROCUREMENT_RELEASED";
    if (
      isActiveLifecycleTicket({
        ticketStatus: r.status,
        protectedStatus: r.protectedTransaction?.status ?? null,
        procReleased,
        hiddenFromChatAt: r.hiddenFromChatAt,
      })
    ) {
      n += 1;
    }
  }
  return n;
}

type TimelineMessageLike = {
  id: string;
  conversationId: string;
  senderId: string | null;
  body: string;
  createdAt: string;
  messageType?: string;
  systemEventType?: string;
  replyAllowed?: boolean;
  paymentTicketId?: string | null;
  attachments?: unknown[];
  sender?: unknown;
};

/**
 * Merge mapped chat messages with PaymentTicket rows.
 * Dedupes by paymentTicketId so ticket+marker does not render twice as cards
 * (card UI already dedupes, but we only inject one synthetic PROPOSED row).
 */
export function mergePaymentTicketsIntoTimeline(
  conversationId: string,
  messages: TimelineMessageLike[],
  tickets: Array<{
    id: string;
    createdById: string;
    createdAt: string;
    revision: number;
    status: string;
    title: string;
  }>,
): TimelineMessageLike[] {
  const visibleIds = new Set(tickets.map((t) => t.id));
  const withoutDead = messages.filter(
    (m) => !m.paymentTicketId || visibleIds.has(m.paymentTicketId),
  );
  const covered = new Set(
    withoutDead
      .map((m) => m.paymentTicketId)
      .filter((id): id is string => Boolean(id)),
  );
  const injected: TimelineMessageLike[] = [];
  for (const t of tickets) {
    if (covered.has(t.id)) continue;
    injected.push({
      id: `payment-ticket:${t.id}`,
      conversationId,
      senderId: t.createdById,
      body: `Payment Ticket v${t.revision} · ${t.title} (${t.status})`,
      createdAt: t.createdAt,
      messageType: "PAYMENT_TICKET",
      systemEventType: "PAYMENT_TICKET_PROPOSED",
      replyAllowed: true,
      paymentTicketId: t.id,
      attachments: [],
    });
  }
  return [...withoutDead, ...injected].sort((a, b) => {
    const at = Date.parse(a.createdAt);
    const bt = Date.parse(b.createdAt);
    if (at !== bt) return at - bt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Block a second active agreement on the same sourcing request in a
 * *different* conversation. Same-conversation multi-ticket is allowed (cap via
 * MAX_ACTIVE_PAYMENT_TICKETS) so funding/completing ticket A never blocks B/C
 * in the same thread.
 */
async function assertNoConcurrentSourcingAgreement(opts: {
  sourcingRequestId: string;
  conversationId: string;
  excludeTicketId?: string | null;
}) {
  const activeTicket = await prisma.paymentTicket.findFirst({
    where: {
      sourcingRequestId: opts.sourcingRequestId,
      status: { in: [...ACTIVE_TICKET_STATUSES] },
      ...(opts.excludeTicketId ? { id: { not: opts.excludeTicketId } } : {}),
      // Same-conversation multi-ticket independence: only other threads.
      conversationId: { not: opts.conversationId },
    },
    select: { id: true, protectedTransactionId: true, status: true, hiddenFromChatAt: true },
  });
  if (activeTicket) {
    // COMPLETED (RELEASED PT) does not block — only true active lifecycles.
    let stillActive = true;
    if (activeTicket.protectedTransactionId) {
      const pt = await prisma.protectedTransaction.findUnique({
        where: { id: activeTicket.protectedTransactionId },
        select: { status: true, procurementTransferredMinor: true },
      });
      const procReleased =
        (pt?.procurementTransferredMinor ?? 0) > 0 ||
        pt?.status === "PROCUREMENT_RELEASED";
      stillActive = isActiveLifecycleTicket({
        ticketStatus: activeTicket.status,
        protectedStatus: pt?.status ?? null,
        procReleased,
        hiddenFromChatAt: activeTicket.hiddenFromChatAt,
      });
    } else {
      stillActive = isActiveLifecycleTicket({
        ticketStatus: activeTicket.status,
        hiddenFromChatAt: activeTicket.hiddenFromChatAt,
      });
    }
    if (stillActive) {
      throw Object.assign(
        new Error(
          "This sourcing request already has an active Payment Ticket agreement",
        ),
        { status: 409, code: "SOURCING_TICKET_ACTIVE" },
      );
    }
  }
  const activeTxn = await prisma.protectedTransaction.findFirst({
    where: {
      sourcingRequestId: opts.sourcingRequestId,
      status: { in: [...ACTIVE_TXN_STATUSES] },
      // Multi-ticket independence: funded/open PT in *this* conversation
      // must not block additional tickets here.
      conversationId: { not: opts.conversationId },
    },
    select: { id: true },
  });
  if (activeTxn) {
    throw Object.assign(
      new Error(
        "This sourcing request already has an active funded or open protected payment",
      ),
      { status: 409, code: "SOURCING_TXN_ACTIVE" },
    );
  }
}

export { mapTicket };

type PartyWithEmail = PartyUser & { email: string };

async function loadParty(userId: string): Promise<PartyWithEmail> {
  const u = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      isDemo: true,
      isTestAccount: true,
      isAdmin: true,
      role: true,
      username: true,
      deletedAt: true,
      trustLevel: true,
      procurementAdvancesEnabled: true,
      identityVerified: true,
    },
  });
  return u;
}

async function resolveAmounts(
  input: TicketAmountsInput,
  seller: PartyUser,
  paymentOption: "PROTECTED" | "INSTANT",
) {
  const config = await getPlatformPaymentConfig();
  const currency = normalizeCurrency(input.currency || "USD");
  assertCurrencyAllowed(currency, config);
  const fees = calculateFees({
    itemCostMinor: input.itemCostMinor,
    shippingMinor: input.shippingMinor ?? 0,
    config,
    paymentOption,
    sellerServiceFeeMinorOverride: input.sellerServiceFeeMinor,
  });
  const agreed = Boolean(input.procurementAdvanceAgreed);
  const eligible = isProcurementEligible({
    globallyEnabled: config.procurementAdvancesGloballyOn,
    featureFlagOn: isProcurementAdvancesEnabled(),
    seller,
    minTrustLevel: config.procurementMinTrustLevel,
    paymentOption,
    agreed,
  });
  const procurementMinor = procurementAdvanceAmount({
    agreed,
    itemCostMinor: fees.itemCostMinor,
    eligible,
  });
  const total = totalChargeMinor(fees);
  return { fees, currency, procurementMinor, total, config };
}

export async function createOrRevisePaymentTicket(opts: {
  conversationId: string;
  actorId: string;
  buyerId: string;
  sellerId: string;
  amounts: TicketAmountsInput;
  /** When set, supersede this specific ticket only (edit terms). */
  reviseFromTicketId?: string | null;
  /** Client idempotency key — safe retries return the same ticket. */
  proposalTraceId?: string | null;
}) {
  if (!isProtectedPaymentsEnabled() && !isDirectPaymentsEnabled()) {
    throw Object.assign(new Error("Protected Payments are not enabled"), {
      status: 503,
      code: "PAYMENTS_DISABLED",
    });
  }

  const paymentOption = normalizeTxnPaymentOption(opts.amounts.paymentOption);
  if (paymentOption === "INSTANT" && !isDirectPaymentsEnabled()) {
    throw Object.assign(new Error("Direct Payment is not enabled"), {
      status: 503,
      code: "DIRECT_DISABLED",
    });
  }
  if (paymentOption === "PROTECTED" && !isProtectedPaymentsEnabled()) {
    throw Object.assign(new Error("Protected Payments are not enabled"), {
      status: 503,
      code: "PROTECTED_DISABLED",
    });
  }

  assertNotSelfTrade(opts.buyerId, opts.sellerId);
  const buyer = await loadParty(opts.buyerId);
  const seller = await loadParty(opts.sellerId);
  assertEligiblePaymentParty(buyer, "buyer");
  assertEligiblePaymentParty(seller, "seller");
  // TEST ramp: when Live is off + Stripe TEST, open to eligible parties (allowlist no-op).
  assertPaymentsTestAllowlisted([buyer, seller], {
    action: "create Payment Ticket",
    labels: ["buyer", "seller"],
  });
  if (opts.actorId !== buyer.id && opts.actorId !== seller.id) {
    throw Object.assign(new Error("Only buyer or seller can propose terms"), {
      status: 403,
    });
  }

  const traceId = (opts.proposalTraceId || "").trim().slice(0, 80) || null;
  if (traceId && !opts.reviseFromTicketId) {
    const prior = await prisma.paymentTicket.findUnique({
      where: { proposalTraceId: traceId },
    });
    if (prior && prior.conversationId === opts.conversationId) {
      const messageRow = await prisma.message.findFirst({
        where: {
          paymentTicketId: prior.id,
          systemEventType: "PAYMENT_TICKET_PROPOSED",
        },
        orderBy: { createdAt: "desc" },
        include: {
          attachments: true,
          sender: { select: participantUserSelect },
        },
      });
      const creator = await prisma.user.findUnique({
        where: { id: prior.createdById },
        select: { id: true, name: true, username: true },
      });
      return {
        ticket: mapTicket(prior, await extrasWithParties(prior, {
          procurementAdvancesFlag: isProcurementAdvancesEnabled(),
          proposedBy: creator,
          viewerId: opts.actorId,
          involvesMoney: false,
        })),
        message: messageRow ? mapMessage(messageRow) : null,
      };
    }
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: opts.conversationId },
    include: { participants: true },
  });
  if (!conversation) {
    throw Object.assign(new Error("Conversation not found"), { status: 404 });
  }
  const participantIds = new Set(conversation.participants.map((p) => p.userId));
  if (!participantIds.has(opts.actorId) || !participantIds.has(opts.buyerId) || !participantIds.has(opts.sellerId)) {
    throw Object.assign(new Error("Not a participant"), { status: 403 });
  }

  const sourcingRequestId = conversation.sourcingRequestId ?? null;
  if (sourcingRequestId) {
    await assertNoConcurrentSourcingAgreement({
      sourcingRequestId,
      conversationId: opts.conversationId,
      excludeTicketId: opts.reviseFromTicketId ?? null,
    });
  }

  const { fees, currency, procurementMinor, total } = await resolveAmounts(
    opts.amounts,
    seller,
    paymentOption,
  );

  // Edit path: supersede one specific open ticket. New proposes never auto-
  // supersede siblings — multi-ticket independence for B/C after A is funded.
  let open: {
    id: string;
    status: string;
    revision: number;
    title: string;
    listingId: string | null;
    protectedTransactionId: string | null;
  } | null = null;

  if (opts.reviseFromTicketId) {
    const target = await prisma.paymentTicket.findFirst({
      where: {
        id: opts.reviseFromTicketId,
        conversationId: opts.conversationId,
      },
    });
    if (!target) {
      throw Object.assign(new Error("Ticket to revise not found"), {
        status: 404,
        code: "TICKET_NOT_FOUND",
      });
    }
    if (!["DRAFT", "PROPOSED", "ACCEPTED"].includes(target.status)) {
      throw Object.assign(
        new Error("Only open unfunded tickets can be revised"),
        { status: 409, code: "TICKET_NOT_REVISABLE" },
      );
    }
    const openPt = await loadProtectedTxnForGuard(target.protectedTransactionId);
    if (
      ticketInvolvesMoney({
        ticketStatus: target.status,
        protectedTxn: openPt,
      })
    ) {
      throw Object.assign(
        new Error("Cannot revise a funded or in-progress Payment Ticket"),
        { status: 409, code: "TICKET_FUNDED" },
      );
    }
    open = target;
  }

  // Max 3 ACTIVE tickets (derived lifecycle). Revising supersedes the old one,
  // so exclude it from the count. Completed (RELEASED) does not count.
  const activeCount = await countActiveConversationTickets(
    opts.conversationId,
    open?.id ?? null,
  );
  if (activeCount >= MAX_ACTIVE_PAYMENT_TICKETS) {
    throw Object.assign(
      new Error("This conversation already has 3 active Payment Tickets"),
      {
        status: 409,
        code: "ACTIVE_TICKET_LIMIT",
        maxActive: MAX_ACTIVE_PAYMENT_TICKETS,
      },
    );
  }

  // Funded / in-progress money ticket on the same sourcing request in a
  // *different* conversation still blocks. Same-conversation funded tickets
  // do not — multi-ticket independence.
  if (sourcingRequestId) {
    const otherSrTickets = await prisma.paymentTicket.findMany({
      where: {
        sourcingRequestId,
        conversationId: { not: opts.conversationId },
        status: { in: [...ACTIVE_TICKET_STATUSES] },
      },
      select: {
        status: true,
        hiddenFromChatAt: true,
        protectedTransaction: {
          select: {
            status: true,
            procurementTransferredMinor: true,
            fundedAt: true,
          },
        },
      },
    });
    const otherActiveMoney = otherSrTickets.some((row) => {
      const st = row.protectedTransaction?.status ?? null;
      const procReleased =
        (row.protectedTransaction?.procurementTransferredMinor ?? 0) > 0 ||
        st === "PROCUREMENT_RELEASED";
      if (
        !isActiveLifecycleTicket({
          ticketStatus: row.status,
          protectedStatus: st,
          procReleased,
          hiddenFromChatAt: row.hiddenFromChatAt,
        })
      ) {
        return false;
      }
      if (row.status === "FUNDED") return true;
      if (row.protectedTransaction?.fundedAt) return true;
      if (
        st &&
        ![
          "DRAFT",
          "AWAITING_ACCEPTANCE",
          "ACCEPTED",
          "AWAITING_PAYMENT",
          "CANCELLED",
        ].includes(st)
      ) {
        return true;
      }
      return false;
    });
    if (otherActiveMoney) {
      throw Object.assign(
        new Error(
          "This sourcing request already has a funded Payment Ticket",
        ),
        { status: 409, code: "SOURCING_FUNDED_TICKET" },
      );
    }
  }

  const revision = open ? open.revision + 1 : 1;
  const title = (opts.amounts.title || open?.title || "Protected Payment").trim();

  const terms: CanonicalTerms = {
    currency,
    itemCostMinor: fees.itemCostMinor,
    shippingMinor: fees.shippingMinor,
    sellerServiceFeeMinor: fees.sellerServiceFeeMinor,
    protectionFeeMinor: fees.protectionFeeMinor,
    totalChargeMinor: total,
    paymentOption,
    procurementAdvanceAgreed: Boolean(opts.amounts.procurementAdvanceAgreed) && procurementMinor > 0,
    procurementAdvanceMinor: procurementMinor,
    title,
    listingId: opts.amounts.listingId ?? open?.listingId ?? conversation.listingId ?? null,
    buyerId: opts.buyerId,
    sellerId: opts.sellerId,
    revision,
  };
  const termsHash = hashTerms(terms);

  const deferredListingReleases: Array<{
    listingId: string;
    buyerId: string;
  }> = [];

  const { ticket, messageId } = await prisma.$transaction(async (tx) => {
    if (open && open.status !== "FUNDED") {
      await tx.paymentTicket.update({
        where: { id: open.id },
        data: { status: "SUPERSEDED" },
      });
      // Outdated revisions cannot fund — cancel any unfunded protected txn.
      if (open.protectedTransactionId) {
        const prior = await tx.protectedTransaction.findUnique({
          where: { id: open.protectedTransactionId },
        });
        if (
          prior &&
          !prior.fundedAt &&
          ["ACCEPTED", "AWAITING_PAYMENT"].includes(prior.status)
        ) {
          await tx.protectedTransaction.update({
            where: { id: prior.id },
            data: { status: "CANCELLED" },
          });
          if (prior.listingId) {
            deferredListingReleases.push({
              listingId: prior.listingId,
              buyerId: prior.buyerId,
            });
          }
        }
      }
    }
    const ticket = await tx.paymentTicket.create({
      data: {
        conversationId: opts.conversationId,
        createdById: opts.actorId,
        buyerId: opts.buyerId,
        sellerId: opts.sellerId,
        listingId: terms.listingId,
        sourcingRequestId,
        status: "PROPOSED",
        revision,
        termsHash,
        title,
        currency,
        itemCostMinor: fees.itemCostMinor,
        shippingMinor: fees.shippingMinor,
        sellerServiceFeeMinor: fees.sellerServiceFeeMinor,
        protectionFeeMinor: fees.protectionFeeMinor,
        totalChargeMinor: total,
        paymentOption,
        procurementAdvanceAgreed: terms.procurementAdvanceAgreed,
        procurementAdvanceMinor: procurementMinor,
        notes: opts.amounts.notes || "",
        stripeMode: getStripeMode(),
        lastMeaningfulActivityAt: new Date(),
        ...(traceId ? { proposalTraceId: traceId } : {}),
        // Creator auto-approves their own revision
        ...(opts.actorId === opts.buyerId
          ? { buyerApprovedRevision: revision, buyerApprovedAt: new Date() }
          : {}),
        ...(opts.actorId === opts.sellerId
          ? { sellerApprovedRevision: revision, sellerApprovedAt: new Date() }
          : {}),
      },
    });

    // Timeline card — required so both parties see the ticket after propose/reload.
    const message = await tx.message.create({
      data: {
        conversationId: opts.conversationId,
        senderId: opts.actorId,
        body: `Payment Ticket v${revision} proposed — Protected by Source Bridge.`,
        messageType: "PAYMENT_TICKET",
        systemEventType: "PAYMENT_TICKET_PROPOSED",
        paymentTicketId: ticket.id,
        replyAllowed: true,
      },
    });
    await tx.conversation.update({
      where: { id: opts.conversationId },
      data: { lastMessageAt: new Date(), updatedAt: new Date() },
    });
    return { ticket, messageId: message.id };
  });

  for (const item of deferredListingReleases) {
    await releaseListingReservation(item.listingId, item.buyerId);
  }
  await recordAuditEvent({
    actorUserId: opts.actorId,
    action: "PAYMENT_TICKET_PROPOSED",
    meta: { ticketId: ticket.id, revision, termsHash, sourcingRequestId },
  });

  const messageRow = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      attachments: true,
      sender: { select: participantUserSelect },
    },
  });
  const creator = await prisma.user.findUnique({
    where: { id: opts.actorId },
    select: { id: true, name: true, username: true },
  });

  const counterpartyId =
    opts.actorId === opts.buyerId ? opts.sellerId : opts.buyerId;
  void import("@/lib/payment-notifications").then(({ notifyPaymentTicketProposed }) =>
    notifyPaymentTicketProposed({
      ticketId: ticket.id,
      conversationId: opts.conversationId,
      counterpartyId,
      actorId: opts.actorId,
      actorName: creator?.name || "",
      actorUsername: creator?.username,
      title: ticket.title,
    }),
  );

  return {
    ticket: mapTicket(ticket, await extrasWithParties(ticket, {
      procurementAdvancesFlag: isProcurementAdvancesEnabled(),
      proposedBy: creator,
      viewerId: opts.actorId,
      involvesMoney: false,
    })),
    message: messageRow ? mapMessage(messageRow) : null,
  };
}

/**
 * Cancel an ACCEPTED (or PROPOSED) unfunded agreement.
 * → CANCELLED, non-actionable, does not block new tickets. No hard-delete.
 */
export async function cancelPaymentTicket(opts: {
  ticketId: string;
  actorId: string;
  reason?: string;
}) {
  const ticket = await prisma.paymentTicket.findUnique({
    where: { id: opts.ticketId },
  });
  if (!ticket) {
    throw Object.assign(new Error("Ticket not found"), { status: 404 });
  }
  await assertPartyToTicket(ticket, opts.actorId);

  if (ticket.status !== "ACCEPTED" && ticket.status !== "PROPOSED") {
    throw Object.assign(
      new Error("Only open or accepted unfunded tickets can be cancelled"),
      { status: 409, code: "TICKET_NOT_CANCELLABLE" },
    );
  }

  // Product rule: ACCEPTED → Cancel Agreement. PROPOSED uses Delete.
  // Allow cancel on PROPOSED only when dual-accept race left it awkward —
  // primary path for ACCEPTED.
  if (ticket.status === "PROPOSED") {
    throw Object.assign(
      new Error("Proposed tickets should be deleted, not cancelled"),
      { status: 409, code: "USE_DELETE" },
    );
  }

  const pt = await loadProtectedTxnForGuard(ticket.protectedTransactionId);
  assertNotFundedForMutation(ticket.status, pt, "cancel");

  const deferredListingReleases: Array<{ listingId: string; buyerId: string }> =
    [];

  const updated = await prisma.$transaction(async (tx) => {
    if (pt && !pt.fundedAt) {
      const unfundedOk = ["ACCEPTED", "AWAITING_PAYMENT", "DRAFT", "AWAITING_ACCEPTANCE"].includes(
        pt.status,
      );
      if (unfundedOk) {
        await tx.protectedTransaction.update({
          where: { id: pt.id },
          data: { status: "CANCELLED", cancelledAt: new Date() },
        });
        if (pt.listingId) {
          deferredListingReleases.push({
            listingId: pt.listingId,
            buyerId: pt.buyerId,
          });
        }
      } else if (pt.status !== "CANCELLED") {
        // Ambiguous state — do not cancel.
        throw Object.assign(
          new Error("Cannot cancel — protected payment state is not clear"),
          { status: 409, code: "TICKET_FUNDED" },
        );
      }
    }

    const row = await tx.paymentTicket.update({
      where: { id: ticket.id },
      data: {
        status: "CANCELLED",
        declineReason: opts.reason || "",
      },
    });

    await tx.message.create({
      data: {
        conversationId: ticket.conversationId,
        senderId: opts.actorId,
        body: "Payment agreement cancelled. A new Payment Ticket may be proposed.",
        messageType: "PAYMENT_TICKET",
        systemEventType: "PAYMENT_TICKET_CANCELLED",
        paymentTicketId: ticket.id,
      },
    });
    await tx.conversation.update({
      where: { id: ticket.conversationId },
      data: { lastMessageAt: new Date(), updatedAt: new Date() },
    });
    return row;
  });

  for (const item of deferredListingReleases) {
    await releaseListingReservation(item.listingId, item.buyerId);
  }

  await recordAuditEvent({
    actorUserId: opts.actorId,
    action: "PAYMENT_TICKET_CANCELLED",
    reason: opts.reason,
    meta: { ticketId: ticket.id },
  });

  return mapTicket(
    updated,
    await extrasWithParties(updated, {
      protectedTxnStatus: "CANCELLED",
      procurementAdvancesFlag: isProcurementAdvancesEnabled(),
      viewerId: opts.actorId,
      involvesMoney: false,
    }),
  );
}

/**
 * Safe hard-delete for PROPOSED / never dual-accepted tickets (no money).
 * Removes timeline markers so the ticket disappears from the active timeline.
 */
export async function deletePaymentTicket(opts: {
  ticketId: string;
  actorId: string;
}) {
  const ticket = await prisma.paymentTicket.findUnique({
    where: { id: opts.ticketId },
  });
  if (!ticket) {
    throw Object.assign(new Error("Ticket not found"), { status: 404 });
  }
  await assertPartyToTicket(ticket, opts.actorId);

  if (ticket.status !== "PROPOSED" && ticket.status !== "DRAFT") {
    throw Object.assign(
      new Error(
        "Only proposed (never fully accepted) unfunded tickets can be deleted",
      ),
      { status: 409, code: "TICKET_NOT_DELETABLE" },
    );
  }

  const pt = await loadProtectedTxnForGuard(ticket.protectedTransactionId);
  assertNotFundedForMutation(ticket.status, pt, "delete");

  // Extra guard: dual-accepted would be ACCEPTED status; refuse if both
  // already approved same revision (race / spoof).
  if (
    ticket.buyerApprovedRevision === ticket.revision &&
    ticket.sellerApprovedRevision === ticket.revision
  ) {
    throw Object.assign(
      new Error("Accepted agreements cannot be hard-deleted — cancel instead"),
      { status: 409, code: "TICKET_NOT_DELETABLE" },
    );
  }

  const deferredListingReleases: Array<{ listingId: string; buyerId: string }> =
    [];

  await prisma.$transaction(async (tx) => {
    if (pt && !pt.fundedAt) {
      if (
        ["ACCEPTED", "AWAITING_PAYMENT", "DRAFT", "AWAITING_ACCEPTANCE"].includes(
          pt.status,
        )
      ) {
        await tx.protectedTransaction.update({
          where: { id: pt.id },
          data: { status: "CANCELLED", cancelledAt: new Date() },
        });
        if (pt.listingId) {
          deferredListingReleases.push({
            listingId: pt.listingId,
            buyerId: pt.buyerId,
          });
        }
      }
    }

    // Detach messages then delete markers so conversation timeline is clean.
    await tx.message.deleteMany({
      where: { paymentTicketId: ticket.id },
    });

    await tx.paymentTicket.update({
      where: { id: ticket.id },
      data: { protectedTransactionId: null },
    });

    await tx.paymentTicket.delete({
      where: { id: ticket.id },
    });
  });

  for (const item of deferredListingReleases) {
    await releaseListingReservation(item.listingId, item.buyerId);
  }

  await recordAuditEvent({
    actorUserId: opts.actorId,
    action: "PAYMENT_TICKET_DELETED",
    meta: {
      ticketId: ticket.id,
      conversationId: ticket.conversationId,
      sourcingRequestId: ticket.sourcingRequestId,
    },
  });

  return {
    deleted: true as const,
    ticketId: ticket.id,
    conversationId: ticket.conversationId,
  };
}

export async function respondToPaymentTicket(opts: {
  ticketId: string;
  actorId: string;
  action: "accept" | "decline";
  reason?: string;
  /** Optional client revision guard — must match current ticket.revision. */
  expectedRevision?: number;
}) {
  const ticket = await prisma.paymentTicket.findUnique({
    where: { id: opts.ticketId },
  });
  if (!ticket) {
    throw Object.assign(new Error("Ticket not found"), { status: 404 });
  }
  if (
    (TICKET_STATUSES_BLOCK_ACCEPT as readonly string[]).includes(ticket.status)
  ) {
    throw Object.assign(
      new Error("This Payment Ticket is closed and cannot be accepted or declined"),
      { status: 409, code: "TICKET_TERMINAL" },
    );
  }
  if (ticket.status !== "PROPOSED" && ticket.status !== "ACCEPTED") {
    throw Object.assign(new Error("Ticket is not open for response"), {
      status: 409,
      code: "TICKET_CLOSED",
    });
  }
  if (opts.actorId !== ticket.buyerId && opts.actorId !== ticket.sellerId) {
    throw Object.assign(new Error("Not a party to this ticket"), { status: 403 });
  }
  const roleModel = resolveTicketRoleModel({
    createdById: ticket.createdById,
    buyerId: ticket.buyerId,
    sellerId: ticket.sellerId,
    viewerId: opts.actorId,
  });
  if (opts.action === "accept" && !roleModel.rolesValid) {
    throw Object.assign(
      new Error(
        "This ticket is missing a valid Buyer/Sourcer assignment. Propose a new revision with explicit roles.",
      ),
      { status: 409, code: "ROLES_NEED_REVISION" },
    );
  }
  if (
    opts.expectedRevision != null &&
    Number(opts.expectedRevision) !== Number(ticket.revision)
  ) {
    throw Object.assign(
      new Error(
        `Revision mismatch — ticket is now v${ticket.revision}. Refresh and review the current terms.`,
      ),
      { status: 409, code: "REVISION_MISMATCH" },
    );
  }

  if (opts.action === "accept") {
    if (!isProtectedPaymentsEnabled() && ticket.paymentOption === "PROTECTED") {
      throw Object.assign(new Error("Protected Payments are not enabled"), {
        status: 503,
        code: "PROTECTED_DISABLED",
      });
    }
    if (!isDirectPaymentsEnabled() && isDirectPaymentOption(ticket.paymentOption)) {
      throw Object.assign(new Error("Direct Payment is not enabled"), {
        status: 503,
        code: "DIRECT_DISABLED",
      });
    }
    const buyer = await loadParty(ticket.buyerId);
    const seller = await loadParty(ticket.sellerId);
    const actor = opts.actorId === buyer.id ? buyer : seller;
    assertPaymentsTestAllowlisted([buyer, seller, actor], {
      action: "accept Payment Ticket",
    });

    // Idempotent: already accepted this revision (alone or both) → no duplicate side effects.
    const isBuyer = opts.actorId === ticket.buyerId;
    const alreadyMine = isBuyer
      ? ticket.buyerApprovedRevision === ticket.revision
      : ticket.sellerApprovedRevision === ticket.revision;
    if (alreadyMine) {
      return mapTicket(ticket, await extrasWithParties(ticket, {
        viewerId: opts.actorId,
        involvesMoney: false,
        procurementAdvancesFlag: isProcurementAdvancesEnabled(),
        protectedTxnStatus: ticket.protectedTransactionId
          ? (
              await prisma.protectedTransaction.findUnique({
                where: { id: ticket.protectedTransactionId },
                select: { status: true },
              })
            )?.status ?? null
          : null,
      }));
    }
  }

  if (opts.action === "decline") {
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.paymentTicket.update({
        where: { id: ticket.id },
        data: {
          status: "DECLINED",
          declinedById: opts.actorId,
          declinedAt: new Date(),
          declineReason: opts.reason || "",
        },
      });
      await tx.message.create({
        data: {
          conversationId: ticket.conversationId,
          senderId: opts.actorId,
          body: "Payment Ticket declined.",
          messageType: "PAYMENT_TICKET",
          systemEventType: "PAYMENT_TICKET_DECLINED",
          paymentTicketId: ticket.id,
        },
      });
      await tx.conversation.update({
        where: { id: ticket.conversationId },
        data: { lastMessageAt: new Date(), updatedAt: new Date() },
      });
      return row;
    });
    await recordAuditEvent({
      actorUserId: opts.actorId,
      action: "PAYMENT_TICKET_DECLINED",
      reason: opts.reason,
      meta: { ticketId: ticket.id },
    });
    return mapTicket(updated, await extrasWithParties(updated, {
      viewerId: opts.actorId,
      involvesMoney: false,
      procurementAdvancesFlag: isProcurementAdvancesEnabled(),
    }));
  }

  // Accept current revision
  const isBuyer = opts.actorId === ticket.buyerId;
  const data = isBuyer
    ? {
        buyerApprovedRevision: ticket.revision,
        buyerApprovedAt: new Date(),
      }
    : {
        sellerApprovedRevision: ticket.revision,
        sellerApprovedAt: new Date(),
      };

  const bothWillApprove =
    (isBuyer
      ? ticket.sellerApprovedRevision === ticket.revision
      : ticket.buyerApprovedRevision === ticket.revision);

  // Block dual-accept if another active funded agreement exists for this sourcing request.
  if (bothWillApprove && ticket.sourcingRequestId) {
    await assertNoConcurrentSourcingAgreement({
      sourcingRequestId: ticket.sourcingRequestId,
      conversationId: ticket.conversationId,
      excludeTicketId: ticket.id,
    });
  }

  const updated = await prisma.$transaction(async (tx) => {
    let row = await tx.paymentTicket.update({
      where: { id: ticket.id },
      data: {
        ...data,
        status: bothWillApprove ? "ACCEPTED" : "PROPOSED",
        lastMeaningfulActivityAt: new Date(),
      },
    });

    await tx.message.create({
      data: {
        conversationId: ticket.conversationId,
        senderId: opts.actorId,
        body: bothWillApprove
          ? `Payment Ticket v${ticket.revision} accepted by both parties. Ready for Protected Payment.`
          : `Payment Ticket v${ticket.revision} approved — waiting for the other party.`,
        messageType: "PAYMENT_TICKET",
        systemEventType: bothWillApprove
          ? "PAYMENT_TICKET_ACCEPTED"
          : "PAYMENT_TICKET_APPROVED",
        paymentTicketId: ticket.id,
      },
    });

    if (bothWillApprove) {
      const protectedTxn = await tx.protectedTransaction.create({
        data: {
          status: "ACCEPTED",
          origin: "CHAT_TICKET",
          paymentOption: ticket.paymentOption,
          buyerId: ticket.buyerId,
          sellerId: ticket.sellerId,
          conversationId: ticket.conversationId,
          listingId: ticket.listingId,
          sourcingRequestId: ticket.sourcingRequestId,
          title: ticket.title,
          currency: ticket.currency,
          stripeMode: getStripeMode(),
          termsHash: ticket.termsHash,
          termsVersion: ticket.revision,
          itemCostMinor: ticket.itemCostMinor,
          shippingMinor: ticket.shippingMinor,
          sellerServiceFeeMinor: ticket.sellerServiceFeeMinor,
          protectionFeeMinor: ticket.protectionFeeMinor,
          totalChargeMinor: ticket.totalChargeMinor,
          procurementAdvanceAgreed: ticket.procurementAdvanceAgreed,
          procurementAdvanceMinor: ticket.procurementAdvanceMinor,
        },
      });
      row = await tx.paymentTicket.update({
        where: { id: ticket.id },
        data: { protectedTransactionId: protectedTxn.id },
      });
    }

    await tx.conversation.update({
      where: { id: ticket.conversationId },
      data: { lastMessageAt: new Date(), updatedAt: new Date() },
    });
    return row;
  });

  await recordAuditEvent({
    actorUserId: opts.actorId,
    action: bothWillApprove
      ? "PAYMENT_TICKET_ACCEPTED"
      : "PAYMENT_TICKET_APPROVED",
    meta: { ticketId: ticket.id, revision: ticket.revision },
  });

  const actorUser = await prisma.user.findUnique({
    where: { id: opts.actorId },
    select: { id: true, name: true, username: true },
  });
  const notifyUserId =
    opts.actorId === ticket.buyerId ? ticket.sellerId : ticket.buyerId;
  void import("@/lib/payment-notifications").then(({ notifyPaymentTicketAccepted }) =>
    notifyPaymentTicketAccepted({
      ticketId: ticket.id,
      conversationId: ticket.conversationId,
      notifyUserId,
      actorId: opts.actorId,
      actorName: actorUser?.name || "",
      actorUsername: actorUser?.username,
      bothAccepted: bothWillApprove,
    }),
  );

  return mapTicket(updated, await extrasWithParties(updated, {
    protectedTxnStatus: bothWillApprove ? "ACCEPTED" : null,
    procurementAdvancesFlag: isProcurementAdvancesEnabled(),
    viewerId: opts.actorId,
    involvesMoney: false,
  }));
}

export async function getPaymentTicket(ticketId: string, viewerId: string) {
  const ticket = await prisma.paymentTicket.findUnique({
    where: { id: ticketId },
    include: {
      createdBy: {
        select: { id: true, name: true, username: true },
      },
      protectedTransaction: {
        select: {
          status: true,
          fundedAt: true,
          stripePaymentIntentId: true,
          procurementTransferredMinor: true,
          finalTransferredMinor: true,
          refundedMinor: true,
          trackingNumber: true,
          trackingCarrier: true,
          shippedAt: true,
          deliveredAt: true,
          inspectionEndsAt: true,
        },
      },
    },
  });
  if (!ticket) {
    throw Object.assign(new Error("Ticket not found"), { status: 404 });
  }
  // Parties only — buyers and sellers; conversation membership must match.
  if (viewerId !== ticket.buyerId && viewerId !== ticket.sellerId) {
    throw Object.assign(new Error("Not a party to this ticket"), { status: 403 });
  }
  const participant = await prisma.conversationParticipant.findUnique({
    where: {
      conversationId_userId: {
        conversationId: ticket.conversationId,
        userId: viewerId,
      },
    },
    select: { leftAt: true },
  });
  if (!participant || participant.leftAt) {
    throw Object.assign(new Error("Not a party to this ticket"), { status: 403 });
  }
  const pt = ticket.protectedTransaction;
  const involvesMoney = ticketInvolvesMoney({
    ticketStatus: ticket.status,
    protectedTxn: pt,
  });
  const paymentIntentStatus = await peekOpenPaymentIntentStatus({
    stripePaymentIntentId: pt?.stripePaymentIntentId,
    fundedAt: pt?.fundedAt ?? null,
    protectedStatus: pt?.status ?? null,
  });
  return mapTicket(ticket, await extrasWithParties(ticket, {
    protectedTxnStatus: pt?.status ?? null,
    paymentIntentStatus,
    procurementTransferredMinor: pt?.procurementTransferredMinor ?? 0,
    finalTransferredMinor: pt?.finalTransferredMinor ?? 0,
    refundedMinor: pt?.refundedMinor ?? 0,
    procurementAdvancesFlag: isProcurementAdvancesEnabled(),
    trackingNumber: pt?.trackingNumber ?? "",
    trackingCarrier: pt?.trackingCarrier ?? "",
    shippedAt: pt?.shippedAt ?? null,
    deliveredAt: pt?.deliveredAt ?? null,
    inspectionEndsAt: pt?.inspectionEndsAt ?? null,
    fundedAt: pt?.fundedAt ?? null,
    proposedBy: ticket.createdBy
      ? {
          id: ticket.createdBy.id,
          name: ticket.createdBy.name,
          username: ticket.createdBy.username,
        }
      : null,
    viewerId,
    involvesMoney,
  }));
}
