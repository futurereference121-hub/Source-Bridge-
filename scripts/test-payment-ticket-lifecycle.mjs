/**
 * Payment Ticket lifecycle: edit / cancel / safe delete / active constraint / funding guard.
 * Pure unit tests (no DB) + optional DB integration when --env-file=.env present.
 *
 * Run: node scripts/test-payment-ticket-lifecycle.mjs
 * Run with DB: node --env-file=.env scripts/test-payment-ticket-lifecycle.mjs
 */
import assert from "node:assert/strict";

// --- Mirrors of tickets.ts guards (keep in sync) ---

const ACTIVE_TICKET_STATUSES = ["DRAFT", "PROPOSED", "ACCEPTED", "FUNDED"];
const INACTIVE_TICKET_STATUSES = [
  "DECLINED",
  "CANCELLED",
  "SUPERSEDED",
  "DELETED",
  "VOIDED",
  "REFUNDED",
];
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
];

function ticketInvolvesMoney(input) {
  if (input.ticketStatus === "FUNDED") return true;
  const pt = input.protectedTxn;
  if (!pt) return false;
  if (pt.fundedAt) return true;
  if ((pt.stripePaymentIntentId || "").trim().length > 0) return true;
  if ((pt.procurementTransferredMinor ?? 0) > 0) return true;
  if ((pt.finalTransferredMinor ?? 0) > 0) return true;
  if ((pt.refundedMinor ?? 0) > 0) return true;
  if (MONEY_TXN_STATUSES.includes(pt.status)) return true;
  return false;
}

function computeTicketLifecycleActions(opts) {
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

function isActiveTicketStatus(status) {
  return ACTIVE_TICKET_STATUSES.includes(status);
}

function blocksNewTicket(status) {
  return isActiveTicketStatus(status);
}

function ok(name, cond) {
  assert.ok(cond, name);
  console.log(`OK   ${name}`);
}

// --- Unit: funding safety ---
ok(
  "FUNDED ticket involves money",
  ticketInvolvesMoney({ ticketStatus: "FUNDED", protectedTxn: null }),
);
ok(
  "PROPOSED without PT unfunded",
  !ticketInvolvesMoney({ ticketStatus: "PROPOSED", protectedTxn: null }),
);
ok(
  "ACCEPTED AWAITING_PAYMENT unfunded without PI",
  !ticketInvolvesMoney({
    ticketStatus: "ACCEPTED",
    protectedTxn: {
      status: "AWAITING_PAYMENT",
      fundedAt: null,
      stripePaymentIntentId: "",
    },
  }),
);
ok(
  "PI present blocks mutation",
  ticketInvolvesMoney({
    ticketStatus: "ACCEPTED",
    protectedTxn: {
      status: "AWAITING_PAYMENT",
      fundedAt: null,
      stripePaymentIntentId: "pi_test_spoof",
    },
  }),
);
ok(
  "fundedAt blocks mutation",
  ticketInvolvesMoney({
    ticketStatus: "ACCEPTED",
    protectedTxn: {
      status: "ACCEPTED",
      fundedAt: new Date(),
      stripePaymentIntentId: "",
    },
  }),
);
ok(
  "transfers block mutation",
  ticketInvolvesMoney({
    ticketStatus: "ACCEPTED",
    protectedTxn: {
      status: "ACCEPTED",
      fundedAt: null,
      stripePaymentIntentId: "",
      procurementTransferredMinor: 100,
    },
  }),
);

// Spoof client sending FUNDED status without real money still blocked by ticket status
ok(
  "spoof FUNDED status cannot delete path",
  ticketInvolvesMoney({ ticketStatus: "FUNDED", protectedTxn: null }),
);

// --- Unit: actions ---
const buyer = "buyer1";
const seller = "seller1";
const stranger = "stranger";

{
  const a = computeTicketLifecycleActions({
    status: "PROPOSED",
    viewerId: buyer,
    buyerId: buyer,
    sellerId: seller,
    involvesMoney: false,
  });
  ok("PROPOSED: canEdit + canDelete", a.canEdit && a.canDelete && !a.canCancel);
}
{
  const a = computeTicketLifecycleActions({
    status: "ACCEPTED",
    viewerId: seller,
    buyerId: buyer,
    sellerId: seller,
    involvesMoney: false,
  });
  ok(
    "ACCEPTED unfunded: canEdit + canCancel, not delete",
    a.canEdit && a.canCancel && !a.canDelete,
  );
}
{
  const a = computeTicketLifecycleActions({
    status: "ACCEPTED",
    viewerId: buyer,
    buyerId: buyer,
    sellerId: seller,
    involvesMoney: true,
  });
  ok(
    "FUNDED/money: no lifecycle actions",
    !a.canEdit && !a.canCancel && !a.canDelete,
  );
}
{
  const a = computeTicketLifecycleActions({
    status: "PROPOSED",
    viewerId: stranger,
    buyerId: buyer,
    sellerId: seller,
    involvesMoney: false,
  });
  ok(
    "unrelated user: no actions",
    !a.canEdit && !a.canCancel && !a.canDelete,
  );
}
{
  const a = computeTicketLifecycleActions({
    status: "CANCELLED",
    viewerId: buyer,
    buyerId: buyer,
    sellerId: seller,
    involvesMoney: false,
  });
  ok("CANCELLED: no actions", !a.canEdit && !a.canCancel && !a.canDelete);
}
{
  const a = computeTicketLifecycleActions({
    status: "SUPERSEDED",
    viewerId: buyer,
    buyerId: buyer,
    sellerId: seller,
    involvesMoney: false,
  });
  ok("SUPERSEDED: no actions", !a.canEdit && !a.canCancel && !a.canDelete);
}

// --- Active vs inactive constraint ---
for (const s of ACTIVE_TICKET_STATUSES) {
  ok(`active ${s} blocks new ticket`, blocksNewTicket(s));
}
for (const s of INACTIVE_TICKET_STATUSES) {
  ok(`inactive ${s} does not block`, !blocksNewTicket(s));
}

// --- Revision invalidates acceptance (model) ---
function revisionInvalidatesAcceptance(prev, nextRevision) {
  return {
    buyerApproved: prev.buyerApprovedRevision === nextRevision,
    sellerApproved: prev.sellerApprovedRevision === nextRevision,
    status: "PROPOSED",
  };
}
{
  const prev = {
    revision: 1,
    buyerApprovedRevision: 1,
    sellerApprovedRevision: 1,
    status: "ACCEPTED",
  };
  const next = revisionInvalidatesAcceptance(prev, 2);
  ok(
    "revision bumps drop prior dual-accept",
    !next.buyerApproved && !next.sellerApproved && next.status === "PROPOSED",
  );
}

// --- Procurement OFF→ON in terms hash space ---
function termsWithProcurement(agreed, itemCostMinor, eligible) {
  const procurementAdvanceMinor =
    agreed && eligible ? itemCostMinor : 0;
  return {
    procurementAdvanceAgreed: agreed && procurementAdvanceMinor > 0,
    procurementAdvanceMinor,
  };
}
{
  const off = termsWithProcurement(false, 500, true);
  const on = termsWithProcurement(true, 500, true);
  ok("procurement OFF baseline", !off.procurementAdvanceAgreed);
  ok(
    "procurement OFF→ON sets advance = item cost",
    on.procurementAdvanceAgreed && on.procurementAdvanceMinor === 500,
  );
}

// --- Supersede flow model ---
function supersedeModel(open, newRevision) {
  return {
    oldStatus: open ? "SUPERSEDED" : null,
    newStatus: "PROPOSED",
    revision: newRevision,
    historicalRetained: Boolean(open),
  };
}
{
  const s = supersedeModel({ status: "ACCEPTED", revision: 1 }, 2);
  ok("superseded retained historically", s.oldStatus === "SUPERSEDED" && s.historicalRetained);
  ok("new is PROPOSED revision++", s.newStatus === "PROPOSED" && s.revision === 2);
}

// API route shape contract
function canHardDelete({ status, involvesMoney, bothApproved }) {
  if (involvesMoney) return false;
  if (status !== "PROPOSED" && status !== "DRAFT") return false;
  if (bothApproved) return false;
  return true;
}
function canCancelAgreement({ status, involvesMoney }) {
  if (involvesMoney) return false;
  return status === "ACCEPTED";
}
ok(
  "PROPOSED unfunded deleteable",
  canHardDelete({ status: "PROPOSED", involvesMoney: false, bothApproved: false }),
);
ok(
  "ACCEPTED not hard-deletable",
  !canHardDelete({ status: "ACCEPTED", involvesMoney: false, bothApproved: true }),
);
ok(
  "FUNDED spoof not deletable",
  !canHardDelete({ status: "FUNDED", involvesMoney: true, bothApproved: true }),
);
ok(
  "ACCEPTED unfunded cancellable",
  canCancelAgreement({ status: "ACCEPTED", involvesMoney: false }),
);
ok(
  "PROPOSED not cancelled via cancel path",
  !canCancelAgreement({ status: "PROPOSED", involvesMoney: false }),
);
ok(
  "money blocks cancel",
  !canCancelAgreement({ status: "ACCEPTED", involvesMoney: true }),
);

console.log("\npayment-ticket-lifecycle unit tests passed");

// Optional DB integration
if (process.env.DATABASE_URL) {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const suffix = `lc_${Date.now().toString(36)}`;

  async function ensureUser(username) {
    const email = `${username}@sourcebridge.test`;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return prisma.user.update({
        where: { id: existing.id },
        data: {
          deletedAt: null,
          emailVerified: true,
          onboardingComplete: true,
          procurementAdvancesEnabled: true,
          trustLevel: 2,
          identityVerified: true,
        },
      });
    }
    return prisma.user.create({
      data: {
        email,
        name: username,
        username,
        slug: username,
        emailVerified: true,
        onboardingComplete: true,
        identityVerified: true,
        identityVerificationStatus: "VERIFIED",
        role: "USER",
        city: "Bangkok",
        country: "Thailand",
        intent: "both",
        specialties: "[]",
        isDemo: false,
        isTestAccount: true,
        procurementAdvancesEnabled: true,
        trustLevel: 2,
      },
    });
  }

  try {
    const uA = await ensureUser(`ticket_lc_a_${suffix}`);
    const uB = await ensureUser(`ticket_lc_b_${suffix}`);
    const uC = await ensureUser(`ticket_lc_c_${suffix}`);

    const pairKey = [uA.id, uB.id].sort().join(":");
    const conv = await prisma.conversation.create({
      data: {
        pairKey: `lc:${pairKey}:${suffix}`,
        participants: {
          create: [{ userId: uA.id }, { userId: uB.id }],
        },
      },
    });

    // PROPOSED → delete frees
    const proposed = await prisma.paymentTicket.create({
      data: {
        conversationId: conv.id,
        createdById: uA.id,
        buyerId: uA.id,
        sellerId: uB.id,
        status: "PROPOSED",
        revision: 1,
        termsHash: "hash1",
        title: "LC PROPOSED",
        currency: "GBP",
        itemCostMinor: 500,
        shippingMinor: 100,
        sellerServiceFeeMinor: 0,
        protectionFeeMinor: 50,
        totalChargeMinor: 650,
        paymentOption: "PROTECTED",
        stripeMode: "TEST",
        buyerApprovedRevision: 1,
        buyerApprovedAt: new Date(),
      },
    });
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        senderId: uA.id,
        body: "ticket proposed",
        messageType: "PAYMENT_TICKET",
        systemEventType: "PAYMENT_TICKET_PROPOSED",
        paymentTicketId: proposed.id,
      },
    });

    // Simulate deletePaymentTicket steps
    await prisma.message.deleteMany({ where: { paymentTicketId: proposed.id } });
    await prisma.paymentTicket.delete({ where: { id: proposed.id } });
    const gone = await prisma.paymentTicket.findUnique({ where: { id: proposed.id } });
    ok("delete removes proposed ticket", gone === null);
    const activeAfterDelete = await prisma.paymentTicket.count({
      where: {
        conversationId: conv.id,
        status: { in: ACTIVE_TICKET_STATUSES },
      },
    });
    ok("no active ticket after delete", activeAfterDelete === 0);

    // ACCEPTED unfunded → cancel frees
    const pt = await prisma.protectedTransaction.create({
      data: {
        status: "ACCEPTED",
        origin: "CHAT_TICKET",
        paymentOption: "PROTECTED",
        buyerId: uA.id,
        sellerId: uB.id,
        conversationId: conv.id,
        title: "LC ACCEPTED",
        currency: "GBP",
        stripeMode: "TEST",
        termsHash: "hash2",
        termsVersion: 1,
        itemCostMinor: 500,
        shippingMinor: 0,
        sellerServiceFeeMinor: 0,
        protectionFeeMinor: 50,
        totalChargeMinor: 550,
      },
    });
    const accepted = await prisma.paymentTicket.create({
      data: {
        conversationId: conv.id,
        createdById: uA.id,
        buyerId: uA.id,
        sellerId: uB.id,
        status: "ACCEPTED",
        revision: 1,
        termsHash: "hash2",
        title: "LC ACCEPTED",
        currency: "GBP",
        itemCostMinor: 500,
        protectionFeeMinor: 50,
        totalChargeMinor: 550,
        paymentOption: "PROTECTED",
        stripeMode: "TEST",
        buyerApprovedRevision: 1,
        sellerApprovedRevision: 1,
        protectedTransactionId: pt.id,
      },
    });
    // Cancel simulation
    await prisma.protectedTransaction.update({
      where: { id: pt.id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    await prisma.paymentTicket.update({
      where: { id: accepted.id },
      data: { status: "CANCELLED" },
    });
    ok(
      "cancelled ticket inactive",
      !isActiveTicketStatus("CANCELLED"),
    );
    const stillBlocks = await prisma.paymentTicket.count({
      where: {
        conversationId: conv.id,
        status: { in: ACTIVE_TICKET_STATUSES },
      },
    });
    ok("cancel frees conversation for new ticket", stillBlocks === 0);

    // Supersede revision++ retention
    const open2 = await prisma.paymentTicket.create({
      data: {
        conversationId: conv.id,
        createdById: uA.id,
        buyerId: uA.id,
        sellerId: uB.id,
        status: "PROPOSED",
        revision: 1,
        termsHash: "hash3",
        title: "LC V1",
        currency: "GBP",
        itemCostMinor: 400,
        protectionFeeMinor: 40,
        totalChargeMinor: 440,
        paymentOption: "PROTECTED",
        procurementAdvanceAgreed: false,
        procurementAdvanceMinor: 0,
        stripeMode: "TEST",
        buyerApprovedRevision: 1,
      },
    });
    await prisma.paymentTicket.update({
      where: { id: open2.id },
      data: { status: "SUPERSEDED" },
    });
    const v2 = await prisma.paymentTicket.create({
      data: {
        conversationId: conv.id,
        createdById: uA.id,
        buyerId: uA.id,
        sellerId: uB.id,
        status: "PROPOSED",
        revision: 2,
        termsHash: "hash4",
        title: "LC V2 PROC",
        currency: "GBP",
        itemCostMinor: 400,
        shippingMinor: 100,
        protectionFeeMinor: 50,
        totalChargeMinor: 550,
        paymentOption: "PROTECTED",
        procurementAdvanceAgreed: true,
        procurementAdvanceMinor: 400,
        stripeMode: "TEST",
        buyerApprovedRevision: 2,
      },
    });
    const old = await prisma.paymentTicket.findUnique({ where: { id: open2.id } });
    ok("superseded retained", old?.status === "SUPERSEDED");
    ok("new revision procurement ON", v2.procurementAdvanceAgreed && v2.revision === 2);
    ok(
      "new revision not auto dual-accepted",
      v2.sellerApprovedRevision !== 2,
    );

    // Security: stranger is not buyer/seller
    ok(
      "stranger not a party",
      uC.id !== accepted.buyerId && uC.id !== accepted.sellerId,
    );

    // Funded block: simulate funded ticket cannot match canDelete
    const fundedGuard = ticketInvolvesMoney({
      ticketStatus: "FUNDED",
      protectedTxn: {
        status: "FUNDED",
        fundedAt: new Date(),
        stripePaymentIntentId: "pi_live_would_block",
      },
    });
    ok("funded cannot mutate", fundedGuard === true);

    // Cleanup
    await prisma.message.deleteMany({ where: { conversationId: conv.id } });
    await prisma.paymentTicket.deleteMany({ where: { conversationId: conv.id } });
    await prisma.protectedTransaction.deleteMany({
      where: { conversationId: conv.id },
    });
    await prisma.conversationParticipant.deleteMany({
      where: { conversationId: conv.id },
    });
    await prisma.conversation.delete({ where: { id: conv.id } });

    console.log("payment-ticket-lifecycle DB checks passed");
  } finally {
    await prisma.$disconnect();
  }
} else {
  console.log("(skip DB checks — no DATABASE_URL)");
}
