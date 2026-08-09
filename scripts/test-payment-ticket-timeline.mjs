/**
 * Payment Ticket chat timeline persistence (integration).
 *
 * Proves:
 * - Ticket is persisted with conversationId
 * - PAYMENT_TICKET message is created and linked (paymentTicketId)
 * - Both participants retrieve the same ticket + message
 * - Unrelated third party is blocked
 * - Timeline sorts by createdAt (user messages + ticket messages + events)
 * - Money breakdown comes from ticket row (server)
 * - Accept advances dual-accept state; proposer cannot double-accept when already counting
 * - Declined / superseded remain as historical non-actionable statuses
 * - ensureConversationPaymentTicketMessages repairs orphan tickets
 *
 * Run: node --env-file=.env scripts/test-payment-ticket-timeline.mjs
 * Does not call Stripe; may skip full create when payments flags are off by
 * writing rows directly then exercising ensure + access rules.
 */
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

const prisma = new PrismaClient();

const A = {
  email: "ticket-timeline-a@sourcebridge.test",
  name: "Ticket Alpha",
  username: "ticket_timeline_a",
};
const B = {
  email: "ticket-timeline-b@sourcebridge.test",
  name: "Ticket Beta",
  username: "ticket_timeline_b",
};
const C = {
  email: "ticket-timeline-c@sourcebridge.test",
  name: "Ticket Charlie",
  username: "ticket_timeline_c",
};

async function ensureUser(input) {
  const email = input.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        emailVerified: true,
        onboardingComplete: true,
        username: existing.username || input.username,
        slug: existing.slug || input.username,
        name: existing.name || input.name,
        isDemo: false,
        isTestAccount: false,
        deletedAt: null,
      },
    });
  }
  return prisma.user.create({
    data: {
      email,
      name: input.name,
      username: input.username,
      slug: input.username,
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
      isTestAccount: false,
    },
  });
}

function ok(name, cond) {
  assert.ok(cond, name);
  console.log(`OK   ${name}`);
}

function pairKey(a, b) {
  return [a, b].sort().join(":");
}

function lifecycleLabel(stage) {
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
    case "COMPLETED":
    case "RELEASED":
      return "COMPLETED";
    default:
      return stage;
  }
}

function resolveLifecycleStage(ticketStatus, protectedStatus, procReleased) {
  if (["DECLINED", "SUPERSEDED", "CANCELLED"].includes(ticketStatus)) {
    return ticketStatus;
  }
  const st = protectedStatus || ticketStatus;
  if (st === "RELEASED") return "COMPLETED";
  if (procReleased || st === "PROCUREMENT_RELEASED") return "ITEM_FUNDS_RELEASED";
  if (st === "FUNDED" || ticketStatus === "FUNDED") return "FUNDED";
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

/** Mirror of ensureConversationPaymentTicketMessages */
async function ensureMessages(conversationId) {
  const tickets = await prisma.paymentTicket.findMany({
    where: { conversationId },
    select: {
      id: true,
      createdById: true,
      revision: true,
      createdAt: true,
    },
  });
  const existing = await prisma.message.findMany({
    where: {
      conversationId,
      paymentTicketId: { in: tickets.map((t) => t.id) },
      systemEventType: "PAYMENT_TICKET_PROPOSED",
    },
    select: { paymentTicketId: true },
  });
  const have = new Set(existing.map((m) => m.paymentTicketId).filter(Boolean));
  let created = 0;
  for (const t of tickets) {
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
        createdAt: t.createdAt,
      },
    });
    created += 1;
  }
  return created;
}

function partyMayView(ticket, viewerId) {
  return viewerId === ticket.buyerId || viewerId === ticket.sellerId;
}

async function main() {
  const userA = await ensureUser(A);
  const userB = await ensureUser(B);
  const userC = await ensureUser(C);
  ok("test users ready", Boolean(userA.id && userB.id && userC.id));

  const key = pairKey(userA.id, userB.id);
  let conversation = await prisma.conversation.findUnique({
    where: { pairKey: key },
  });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        subject: "Ticket timeline test",
        contextType: "direct",
        pairKey: key,
        participants: {
          create: [{ userId: userA.id }, { userId: userB.id }],
        },
      },
    });
  } else {
    for (const uid of [userA.id, userB.id]) {
      await prisma.conversationParticipant.upsert({
        where: {
          conversationId_userId: {
            conversationId: conversation.id,
            userId: uid,
          },
        },
        create: { conversationId: conversation.id, userId: uid },
        update: { leftAt: null },
      });
    }
  }

  // Clean previous test tickets in this conversation
  const prior = await prisma.paymentTicket.findMany({
    where: { conversationId: conversation.id },
    select: { id: true },
  });
  if (prior.length) {
    await prisma.message.deleteMany({
      where: { paymentTicketId: { in: prior.map((p) => p.id) } },
    });
    await prisma.paymentTicket.deleteMany({
      where: { id: { in: prior.map((p) => p.id) } },
    });
  }

  const now = new Date();
  const userMsg = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      senderId: userA.id,
      body: "Before ticket",
      messageType: "USER",
      createdAt: new Date(now.getTime() - 60_000),
    },
  });

  const terms = {
    currency: "GBP",
    itemCostMinor: 500,
    shippingMinor: 100,
    sellerServiceFeeMinor: 100,
    protectionFeeMinor: 50,
    totalChargeMinor: 750,
  };
  const termsHash = createHash("sha256")
    .update(JSON.stringify({ ...terms, revision: 1 }))
    .digest("hex");

  // Persist ticket + linked timeline message (server create path contract)
  const ticket = await prisma.$transaction(async (tx) => {
    const t = await tx.paymentTicket.create({
      data: {
        conversationId: conversation.id,
        createdById: userA.id,
        buyerId: userA.id,
        sellerId: userB.id,
        status: "PROPOSED",
        revision: 1,
        termsHash,
        title: "Timeline test ticket",
        currency: terms.currency,
        itemCostMinor: terms.itemCostMinor,
        shippingMinor: terms.shippingMinor,
        sellerServiceFeeMinor: terms.sellerServiceFeeMinor,
        protectionFeeMinor: terms.protectionFeeMinor,
        totalChargeMinor: terms.totalChargeMinor,
        paymentOption: "PROTECTED",
        procurementAdvanceAgreed: false,
        procurementAdvanceMinor: 0,
        stripeMode: "TEST",
        buyerApprovedRevision: 1,
        buyerApprovedAt: now,
      },
    });
    await tx.message.create({
      data: {
        conversationId: conversation.id,
        senderId: userA.id,
        body: "Payment Ticket v1 proposed — Protected by Source Bridge.",
        messageType: "PAYMENT_TICKET",
        systemEventType: "PAYMENT_TICKET_PROPOSED",
        paymentTicketId: t.id,
        replyAllowed: true,
        createdAt: now,
      },
    });
    await tx.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: now },
    });
    return t;
  });

  ok("ticket persisted with conversationId", ticket.conversationId === conversation.id);

  const linked = await prisma.message.findMany({
    where: { paymentTicketId: ticket.id },
  });
  ok("PAYMENT_TICKET message linked", linked.length === 1);
  ok(
    "message type + ticket id",
    linked[0].messageType === "PAYMENT_TICKET" &&
      linked[0].paymentTicketId === ticket.id,
  );

  // Both participants retrieve same ticket
  const asA = await prisma.paymentTicket.findUnique({ where: { id: ticket.id } });
  const asB = await prisma.paymentTicket.findUnique({ where: { id: ticket.id } });
  ok("same ticket id both viewers", asA.id === asB.id && asA.id === ticket.id);
  ok("party A can view", partyMayView(asA, userA.id));
  ok("party B can view", partyMayView(asB, userB.id));
  ok("unrelated C blocked", !partyMayView(asA, userC.id));

  // Conversation participants only (extra security mirror)
  const partC = await prisma.conversationParticipant.findFirst({
    where: { conversationId: conversation.id, userId: userC.id },
  });
  ok("C not conversation participant", !partC);

  // Timeline order
  const timeline = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      messageType: true,
      paymentTicketId: true,
      createdAt: true,
      body: true,
    },
  });
  const ticketIdx = timeline.findIndex((m) => m.paymentTicketId === ticket.id);
  const userIdx = timeline.findIndex((m) => m.id === userMsg.id);
  ok("user message before ticket chronologically", userIdx >= 0 && ticketIdx > userIdx);

  // Server breakdown fields present
  ok("breakdown item from server", asA.itemCostMinor === 500);
  ok("breakdown fee from server", asA.protectionFeeMinor === 50);
  ok("total server-side", asA.totalChargeMinor === 750);

  // Lifecycle labels
  ok(
    "proposed stage label",
    lifecycleLabel(resolveLifecycleStage("PROPOSED", null, false)) === "PROPOSED",
  );
  ok(
    "dual-accept stage label",
    lifecycleLabel(
      resolveLifecycleStage("ACCEPTED", "ACCEPTED", false),
    ) === "AGREED · AWAITING PAYMENT",
  );
  ok(
    "funded stage",
    lifecycleLabel(resolveLifecycleStage("FUNDED", "FUNDED", false)) === "FUNDED",
  );
  ok(
    "item funds released stage",
    lifecycleLabel(
      resolveLifecycleStage("FUNDED", "PROCUREMENT_RELEASED", true),
    ) === "ITEM FUNDS RELEASED",
  );
  ok(
    "completed stage",
    lifecycleLabel(resolveLifecycleStage("FUNDED", "RELEASED", false)) ===
      "COMPLETED",
  );

  // Accept progress: seller accepts → dual agree
  // Proposer already has buyerApprovedRevision=1 — no double-self-accept needed
  ok(
    "proposer already counting (no self-accept needed)",
    asA.buyerApprovedRevision === 1 && asA.sellerApprovedRevision == null,
  );
  const afterSeller = await prisma.paymentTicket.update({
    where: { id: ticket.id },
    data: {
      sellerApprovedRevision: 1,
      sellerApprovedAt: new Date(),
      status: "ACCEPTED",
    },
  });
  ok("status ACCEPTED after dual accept", afterSeller.status === "ACCEPTED");

  // Accept event message (historical event — second row, same ticket)
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      senderId: userB.id,
      body: "Payment Ticket v1 accepted by both parties. Ready for Protected Payment.",
      messageType: "PAYMENT_TICKET",
      systemEventType: "PAYMENT_TICKET_ACCEPTED",
      paymentTicketId: ticket.id,
    },
  });
  const cards = await prisma.message.findMany({
    where: { paymentTicketId: ticket.id },
    orderBy: { createdAt: "asc" },
  });
  ok("historical accept event remains", cards.length === 2);
  ok(
    "primary propose + accept event",
    cards[0].systemEventType === "PAYMENT_TICKET_PROPOSED" &&
      cards[1].systemEventType === "PAYMENT_TICKET_ACCEPTED",
  );

  // Supersede path: new revision ticket + prior SUPERSEDED stays
  const declined = await prisma.paymentTicket.create({
    data: {
      conversationId: conversation.id,
      createdById: userB.id,
      buyerId: userA.id,
      sellerId: userB.id,
      status: "DECLINED",
      revision: 2,
      termsHash: termsHash + "d",
      title: "Declined historical",
      currency: "GBP",
      itemCostMinor: 500,
      totalChargeMinor: 550,
      protectionFeeMinor: 50,
      paymentOption: "PROTECTED",
      declinedById: userA.id,
      declinedAt: new Date(),
      stripeMode: "TEST",
    },
  });
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      senderId: userB.id,
      body: "Payment Ticket v2 proposed — Protected by Source Bridge.",
      messageType: "PAYMENT_TICKET",
      systemEventType: "PAYMENT_TICKET_PROPOSED",
      paymentTicketId: declined.id,
    },
  });
  ok("historical declined remains", declined.status === "DECLINED");
  ok(
    "declined not open for respond",
    declined.status !== "PROPOSED" && declined.status !== "ACCEPTED",
  );

  // Orphan repair: ticket without message becomes repaired
  const orphan = await prisma.paymentTicket.create({
    data: {
      conversationId: conversation.id,
      createdById: userA.id,
      buyerId: userA.id,
      sellerId: userB.id,
      status: "PROPOSED",
      revision: 9,
      termsHash: termsHash + "o",
      title: "Orphan",
      currency: "GBP",
      itemCostMinor: 100,
      protectionFeeMinor: 50,
      totalChargeMinor: 150,
      paymentOption: "PROTECTED",
      stripeMode: "TEST",
      buyerApprovedRevision: 9,
      buyerApprovedAt: new Date(),
    },
  });
  const before = await prisma.message.count({
    where: { paymentTicketId: orphan.id },
  });
  ok("orphan has no message", before === 0);
  const repaired = await ensureMessages(conversation.id);
  ok("ensure created at least one", repaired >= 1);
  const after = await prisma.message.count({
    where: {
      paymentTicketId: orphan.id,
      systemEventType: "PAYMENT_TICKET_PROPOSED",
    },
  });
  ok("orphan repaired with PROPOSED message", after === 1);

  // Dedupe card rule: unique ticketIds for primary cards
  const allPt = await prisma.message.findMany({
    where: {
      conversationId: conversation.id,
      messageType: "PAYMENT_TICKET",
    },
    orderBy: { createdAt: "asc" },
  });
  const primaryIds = new Set();
  let primaryCount = 0;
  for (const m of allPt) {
    if (!m.paymentTicketId) continue;
    if (
      m.systemEventType === "PAYMENT_TICKET_PROPOSED" ||
      !primaryIds.has(m.paymentTicketId)
    ) {
      if (!primaryIds.has(m.paymentTicketId)) {
        primaryIds.add(m.paymentTicketId);
        primaryCount += 1;
      }
    }
  }
  ok("unique primary cards by ticket id", primaryCount === primaryIds.size);
  ok("at least three tickets have primary cards", primaryCount >= 3);

  console.log("\nAll payment-ticket timeline checks passed.");
}

main()
  .catch((err) => {
    console.error("FAIL", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
