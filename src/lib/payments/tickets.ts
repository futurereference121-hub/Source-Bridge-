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

/** Ticket statuses that block a second concurrent agreement on the same sourcing request. */
const ACTIVE_TICKET_STATUSES = ["DRAFT", "PROPOSED", "ACCEPTED", "FUNDED"] as const;

/** Protected txn statuses still in flight (historical RELEASED/REFUNDED/CANCELLED OK). */
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
  },
  extras?: {
    protectedTxnStatus?: string | null;
    procurementTransferredMinor?: number;
    finalTransferredMinor?: number;
    refundedMinor?: number;
    procurementAdvancesFlag?: boolean;
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

  return {
    id: t.id,
    conversationId: t.conversationId,
    createdById: t.createdById,
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
    lifecycleStage: resolveLifecycleStage(t.status, protectedStatus, procReleased),
    books,
    actions: {
      canReleaseProcurement: procPending,
      canPay:
        t.status === "ACCEPTED" && Boolean(t.protectedTransactionId),
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
              note: "Item funds may be released early after the buyer authorizes release. Shipping, sourcer fee, and Source Bridge fee stay protected.",
            }
          : null,
    },
  };
}

function resolveLifecycleStage(
  ticketStatus: string,
  protectedStatus: string | null,
  procReleased: boolean,
): string {
  if (ticketStatus === "DECLINED" || ticketStatus === "SUPERSEDED" || ticketStatus === "CANCELLED") {
    return ticketStatus;
  }
  const st = protectedStatus || ticketStatus;
  if (st === "RELEASED") return "RELEASED";
  if (st === "REFUNDED" || st === "PARTIALLY_REFUNDED") return st;
  if (st === "DISPUTED") return "DISPUTED";
  if (["IN_INSPECTION", "READY_TO_RELEASE"].includes(st)) return st;
  if (["IN_TRANSIT", "DELIVERED", "AWAITING_SHIPMENT"].includes(st)) return st;
  if (procReleased || st === "PROCUREMENT_RELEASED") return "PROCUREMENT_RELEASED";
  if (st === "FUNDED" || ticketStatus === "FUNDED") return "FUNDED";
  if (st === "AWAITING_PAYMENT") return "AWAITING_PAYMENT";
  if (ticketStatus === "ACCEPTED") return "ACCEPTED";
  if (ticketStatus === "PROPOSED") return "PROPOSED";
  return ticketStatus;
}

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
      // Same conversation supersede is handled separately; block other threads.
      conversationId: { not: opts.conversationId },
    },
    select: { id: true },
  });
  if (activeTicket) {
    throw Object.assign(
      new Error(
        "This sourcing request already has an active Payment Ticket agreement",
      ),
      { status: 409, code: "SOURCING_TICKET_ACTIVE" },
    );
  }
  const activeTxn = await prisma.protectedTransaction.findFirst({
    where: {
      sourcingRequestId: opts.sourcingRequestId,
      status: { in: [...ACTIVE_TXN_STATUSES] },
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
  // Controlled TEST ramp — empty allowlist = deny; both parties must match.
  assertPaymentsTestAllowlisted([buyer, seller], {
    action: "create Payment Ticket",
  });
  if (opts.actorId !== buyer.id && opts.actorId !== seller.id) {
    throw Object.assign(new Error("Only buyer or seller can propose terms"), {
      status: 403,
    });
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
    });
  }

  const { fees, currency, procurementMinor, total } = await resolveAmounts(
    opts.amounts,
    seller,
    paymentOption,
  );

  const open = await prisma.paymentTicket.findFirst({
    where: {
      conversationId: opts.conversationId,
      status: { in: ["DRAFT", "PROPOSED", "ACCEPTED"] },
    },
    orderBy: { createdAt: "desc" },
  });

  // Same conversation supersede — still block if another ticket for this
  // sourcing request is already FUNDED.
  if (sourcingRequestId) {
    const fundedElsewhere = await prisma.paymentTicket.findFirst({
      where: {
        sourcingRequestId,
        status: "FUNDED",
        ...(open ? { id: { not: open.id } } : {}),
      },
      select: { id: true },
    });
    if (fundedElsewhere) {
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

  const result = await prisma.$transaction(async (tx) => {
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
        // Creator auto-approves their own revision
        ...(opts.actorId === opts.buyerId
          ? { buyerApprovedRevision: revision, buyerApprovedAt: new Date() }
          : {}),
        ...(opts.actorId === opts.sellerId
          ? { sellerApprovedRevision: revision, sellerApprovedAt: new Date() }
          : {}),
      },
    });

    await tx.message.create({
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
    return ticket;
  });

  for (const item of deferredListingReleases) {
    await releaseListingReservation(item.listingId, item.buyerId);
  }
  await recordAuditEvent({
    actorUserId: opts.actorId,
    action: "PAYMENT_TICKET_PROPOSED",
    meta: { ticketId: result.id, revision, termsHash, sourcingRequestId },
  });

  return mapTicket(result, {
    procurementAdvancesFlag: isProcurementAdvancesEnabled(),
  });
}

export async function respondToPaymentTicket(opts: {
  ticketId: string;
  actorId: string;
  action: "accept" | "decline";
  reason?: string;
}) {
  const ticket = await prisma.paymentTicket.findUnique({
    where: { id: opts.ticketId },
  });
  if (!ticket) {
    throw Object.assign(new Error("Ticket not found"), { status: 404 });
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
    return mapTicket(updated);
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

  return mapTicket(updated, {
    protectedTxnStatus: bothWillApprove ? "ACCEPTED" : null,
    procurementAdvancesFlag: isProcurementAdvancesEnabled(),
  });
}

export async function getPaymentTicket(ticketId: string, viewerId: string) {
  const ticket = await prisma.paymentTicket.findUnique({
    where: { id: ticketId },
    include: {
      protectedTransaction: {
        select: {
          status: true,
          procurementTransferredMinor: true,
          finalTransferredMinor: true,
          refundedMinor: true,
        },
      },
    },
  });
  if (!ticket) {
    throw Object.assign(new Error("Ticket not found"), { status: 404 });
  }
  if (viewerId !== ticket.buyerId && viewerId !== ticket.sellerId) {
    throw Object.assign(new Error("Not a party to this ticket"), { status: 403 });
  }
  const pt = ticket.protectedTransaction;
  return mapTicket(ticket, {
    protectedTxnStatus: pt?.status ?? null,
    procurementTransferredMinor: pt?.procurementTransferredMinor ?? 0,
    finalTransferredMinor: pt?.finalTransferredMinor ?? 0,
    refundedMinor: pt?.refundedMinor ?? 0,
    procurementAdvancesFlag: isProcurementAdvancesEnabled(),
  });
}
