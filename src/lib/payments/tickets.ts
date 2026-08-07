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
  isInstantPaymentsEnabled,
  isProcurementAdvancesEnabled,
  isProtectedPaymentsEnabled,
} from "@/lib/payments/flags";
import { recordAuditEvent } from "@/lib/payments/ledger";
import { normalizeCurrency, totalChargeMinor } from "@/lib/payments/money";
import { hashTerms, type CanonicalTerms } from "@/lib/payments/terms";
import { releaseListingReservation } from "@/lib/payments/listing-lifecycle";

export type TicketAmountsInput = {
  itemCostMinor: number;
  shippingMinor?: number;
  sellerServiceFeeMinor?: number;
  title?: string;
  notes?: string;
  paymentOption?: "PROTECTED" | "INSTANT";
  procurementAdvanceAgreed?: boolean;
  listingId?: string | null;
  currency?: string;
};

function mapTicket(t: {
  id: string;
  conversationId: string;
  createdById: string;
  buyerId: string;
  sellerId: string;
  listingId: string | null;
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
}) {
  return {
    id: t.id,
    conversationId: t.conversationId,
    createdById: t.createdById,
    buyerId: t.buyerId,
    sellerId: t.sellerId,
    listingId: t.listingId,
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
    stripeMode: t.stripeMode,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    breakdown: {
      itemCost: t.itemCostMinor,
      shipping: t.shippingMinor,
      sellerServiceFee: t.sellerServiceFeeMinor,
      sourceBridgeProtectionFee: t.protectionFeeMinor,
      total: t.totalChargeMinor,
      labels: {
        itemCost: "Item Cost",
        shipping: "Shipping",
        sellerServiceFee: "Seller Service Fee",
        sourceBridgeProtectionFee: "Source Bridge Protection Fee",
      },
    },
  };
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
  if (!isProtectedPaymentsEnabled() && opts.amounts.paymentOption !== "INSTANT") {
    // Allow ticket creation when protected flag on; instant needs its flag.
  }
  if (!isProtectedPaymentsEnabled() && !isInstantPaymentsEnabled()) {
    throw Object.assign(new Error("Protected Payments are not enabled"), {
      status: 503,
      code: "PAYMENTS_DISABLED",
    });
  }

  const paymentOption =
    opts.amounts.paymentOption === "INSTANT" ? "INSTANT" : "PROTECTED";
  if (paymentOption === "INSTANT" && !isInstantPaymentsEnabled()) {
    throw Object.assign(new Error("Instant payments are not enabled"), {
      status: 503,
      code: "INSTANT_DISABLED",
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
    meta: { ticketId: result.id, revision, termsHash },
  });

  return mapTicket(result);
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
    if (!isInstantPaymentsEnabled() && ticket.paymentOption === "INSTANT") {
      throw Object.assign(new Error("Instant payments are not enabled"), {
        status: 503,
        code: "INSTANT_DISABLED",
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

  return mapTicket(updated);
}

export async function getPaymentTicket(ticketId: string, viewerId: string) {
  const ticket = await prisma.paymentTicket.findUnique({
    where: { id: ticketId },
  });
  if (!ticket) {
    throw Object.assign(new Error("Ticket not found"), { status: 404 });
  }
  if (viewerId !== ticket.buyerId && viewerId !== ticket.sellerId) {
    throw Object.assign(new Error("Not a party to this ticket"), { status: 403 });
  }
  return mapTicket(ticket);
}
