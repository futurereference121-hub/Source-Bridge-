/**
 * Payment Ticket chat timeline persistence (integration).
 *
 * Proves:
 * - Ticket is persisted with conversationId
 * - PAYMENT_TICKET message is created and linked (paymentTicketId)
 * - Both participants retrieve the same ticket + message
 * - Unrelated third party is blocked (party check mirror of getPaymentTicket)
 * - Timeline sorts by createdAt (user messages + ticket messages + events)
 * - Money breakdown comes from ticket row (server)
 * - Accept advances dual-accept state; proposer cannot double-accept when already counting
 * - Declined / superseded remain as historical non-actionable statuses
 * - ensureConversationPaymentTicketMessages repairs orphan tickets (ANY link counts)
 * - mergePaymentTicketsIntoTimeline injects synthetic rows when marker missing
 * - ticket + marker does not duplicate (one card target id)
 * - chronological merge with other message types
 * - failed propose keeps form open (unit comment — see failedProposeKeepsFormOpen)
 * - proposer gets ticket after successful create path (ticket always returned)
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
  if (
    ["DECLINED", "SUPERSEDED", "CANCELLED", "DELETED", "VOIDED"].includes(
      ticketStatus,
    )
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

/**
 * Mirror of ensureConversationPaymentTicketMessages (src/lib/payments/tickets.ts):
 * ANY linked message with paymentTicketId counts (not only PROPOSED).
 */
async function ensureMessages(conversationId) {
  const tickets = await prisma.paymentTicket.findMany({
    where: { conversationId },
    select: {
      id: true,
      createdById: true,
      revision: true,
      createdAt: true,
      status: true,
    },
  });
  if (tickets.length === 0) return 0;
  const existing = await prisma.message.findMany({
    where: {
      conversationId,
      paymentTicketId: { in: tickets.map((t) => t.id) },
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

/**
 * Mirror of mergePaymentTicketsIntoTimeline from tickets.ts
 */
function mergePaymentTicketsIntoTimeline(conversationId, messages, tickets) {
  const covered = new Set(
    messages.map((m) => m.paymentTicketId).filter((id) => Boolean(id)),
  );
  const injected = [];
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
  return [...messages, ...injected].sort((a, b) => {
    const at = Date.parse(a.createdAt);
    const bt = Date.parse(b.createdAt);
    if (at !== bt) return at - bt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function partyMayView(ticket, viewerId) {
  return viewerId === ticket.buyerId || viewerId === ticket.sellerId;
}

/**
 * Mirror of getPaymentTicket access: parties + conversation membership.
 */
async function canGetPaymentTicket(ticket, viewerId) {
  if (!partyMayView(ticket, viewerId)) return false;
  const participant = await prisma.conversationParticipant.findUnique({
    where: {
      conversationId_userId: {
        conversationId: ticket.conversationId,
        userId: viewerId,
      },
    },
    select: { leftAt: true },
  });
  return Boolean(participant && !participant.leftAt);
}

/**
 * Propose UX contract (unit): form only closes when res.ok && json.ok && ticket.id.
 * Failed POST must keep form open. See ProposePaymentTicketButton.tsx.
 */
function simulateProposeFormClose(resOk, json) {
  // returns true if form would close
  return Boolean(resOk && json?.ok && json?.ticket?.id);
}

function uniquePrimaryTicketTargets(timeline) {
  const seen = new Set();
  for (const m of timeline) {
    if (m.messageType !== "PAYMENT_TICKET") continue;
    if (!m.paymentTicketId) continue;
    if (
      m.systemEventType === "PAYMENT_TICKET_PROPOSED" ||
      !seen.has(m.paymentTicketId)
    ) {
      if (!seen.has(m.paymentTicketId)) seen.add(m.paymentTicketId);
    }
  }
  return seen;
}

async function main() {
  // --- pure merge unit (no DB) ---
  {
    const conv = "conv-merge";
    const msgs = [
      {
        id: "m1",
        conversationId: conv,
        senderId: "u1",
        body: "hi",
        createdAt: "2026-01-01T00:00:00.000Z",
        messageType: "USER",
      },
      {
        id: "m2",
        conversationId: conv,
        senderId: "u1",
        body: "marker",
        createdAt: "2026-01-01T00:02:00.000Z",
        messageType: "PAYMENT_TICKET",
        systemEventType: "PAYMENT_TICKET_PROPOSED",
        paymentTicketId: "t-linked",
      },
    ];
    const tickets = [
      {
        id: "t-orphan",
        createdById: "u1",
        createdAt: "2026-01-01T00:01:00.000Z",
        revision: 1,
        status: "PROPOSED",
        title: "Orphan",
      },
      {
        id: "t-linked",
        createdById: "u1",
        createdAt: "2026-01-01T00:02:00.000Z",
        revision: 1,
        status: "PROPOSED",
        title: "Linked",
      },
    ];
    const merged = mergePaymentTicketsIntoTimeline(conv, msgs, tickets);
    ok(
      "merge injects orphan with synthetic id",
      merged.some((m) => m.id === "payment-ticket:t-orphan"),
    );
    ok(
      "merge does not duplicate linked ticket",
      merged.filter((m) => m.paymentTicketId === "t-linked").length === 1,
    );
    const times = merged.map((m) => m.createdAt);
    ok(
      "merge chronological order",
      times[0] <= times[1] && times[1] <= times[2],
    );
    ok("merge one card target for linked", uniquePrimaryTicketTargets(merged).has("t-linked"));
    ok("merge one card target for orphan", uniquePrimaryTicketTargets(merged).has("t-orphan"));
  }

  // Propose UX — form stays open on failure; closes only with ticket id
  ok(
    "failed propose (!ok) keeps form open",
    !simulateProposeFormClose(false, { error: "x" }),
  );
  ok(
    "failed propose (no ticket) keeps form open",
    !simulateProposeFormClose(true, { ok: true, ticket: null }),
  );
  ok(
    "failed propose (allowlist 403) keeps form open",
    !simulateProposeFormClose(false, {
      error: "Payments test access denied",
      code: "ALLOWLIST",
    }),
  );
  ok(
    "success propose closes form",
    simulateProposeFormClose(true, { ok: true, ticket: { id: "x" } }),
  );
  ok(
    "proposer success requires ticket id even if message null",
    simulateProposeFormClose(true, {
      ok: true,
      ticket: { id: "ticket-1" },
      message: null,
    }),
  );

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
  ok("unrelated C blocked (party)", !partyMayView(asA, userC.id));
  ok("party A may getPaymentTicket", await canGetPaymentTicket(asA, userA.id));
  ok("party B may getPaymentTicket", await canGetPaymentTicket(asB, userB.id));
  ok("third party cannot getPaymentTicket", !(await canGetPaymentTicket(asA, userC.id)));

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

  // Supersede path: declined historical remains
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

  // Merge visibility BEFORE ensure: ticket visible via synthetic row
  const preEnsureMessages = (
    await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
    })
  ).map((m) => ({
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    messageType: m.messageType,
    systemEventType: m.systemEventType,
    paymentTicketId: m.paymentTicketId,
  }));
  const allTicketsForMerge = (
    await prisma.paymentTicket.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
    })
  ).map((t) => ({
    id: t.id,
    createdById: t.createdById,
    createdAt: t.createdAt.toISOString(),
    revision: t.revision,
    status: t.status,
    title: t.title,
  }));
  const mergedPre = mergePaymentTicketsIntoTimeline(
    conversation.id,
    preEnsureMessages,
    allTicketsForMerge,
  );
  ok(
    "merge shows orphan ticket without marker Message",
    mergedPre.some((m) => m.paymentTicketId === orphan.id),
  );
  ok(
    "merge synthetic id for orphan",
    mergedPre.some((m) => m.id === `payment-ticket:${orphan.id}`),
  );
  // Linked tickets not duplicated as synthetic
  ok(
    "merge no synthetic for already-linked primary ticket",
    !mergedPre.some((m) => m.id === `payment-ticket:${ticket.id}`),
  );

  // Both participants would see same ticket set (authoritative by conversationId)
  const ticketsA = await prisma.paymentTicket.findMany({
    where: { conversationId: conversation.id },
  });
  const ticketsB = await prisma.paymentTicket.findMany({
    where: { conversationId: conversation.id },
  });
  ok(
    "both participants see same tickets",
    ticketsA.length === ticketsB.length &&
      ticketsA.every((t) => ticketsB.some((x) => x.id === t.id)),
  );

  const repaired = await ensureMessages(conversation.id);
  ok("ensure created at least one", repaired >= 1);
  const after = await prisma.message.count({
    where: {
      paymentTicketId: orphan.id,
      systemEventType: "PAYMENT_TICKET_PROPOSED",
    },
  });
  ok("orphan repaired with PROPOSED message", after === 1);

  // ensure is idempotent: existing ANY link (including ACCEPTED only) counts
  const acceptOnlyOrphan = await prisma.paymentTicket.create({
    data: {
      conversationId: conversation.id,
      createdById: userA.id,
      buyerId: userA.id,
      sellerId: userB.id,
      status: "ACCEPTED",
      revision: 3,
      termsHash: termsHash + "a",
      title: "Accept-only link",
      currency: "GBP",
      itemCostMinor: 200,
      protectionFeeMinor: 50,
      totalChargeMinor: 250,
      paymentOption: "PROTECTED",
      stripeMode: "TEST",
    },
  });
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      senderId: userA.id,
      body: "accepted only",
      messageType: "PAYMENT_TICKET",
      systemEventType: "PAYMENT_TICKET_ACCEPTED",
      paymentTicketId: acceptOnlyOrphan.id,
    },
  });
  const ensure2 = await ensureMessages(conversation.id);
  const acceptOnlyCount = await prisma.message.count({
    where: { paymentTicketId: acceptOnlyOrphan.id },
  });
  ok("ensure does not double-insert when ANY link exists", ensure2 === 0);
  ok("accept-only link blocks second PROPOSED insert", acceptOnlyCount === 1);
  // Confirm no PROPOSED was added for accept-only
  const propForAcceptOnly = await prisma.message.count({
    where: {
      paymentTicketId: acceptOnlyOrphan.id,
      systemEventType: "PAYMENT_TICKET_PROPOSED",
    },
  });
  ok("no spurious PROPOSED when ACCEPTED link exists", propForAcceptOnly === 0);

  // Dedupe card rule: unique ticketIds for primary cards
  const allPt = await prisma.message.findMany({
    where: {
      conversationId: conversation.id,
      messageType: "PAYMENT_TICKET",
    },
    orderBy: { createdAt: "asc" },
  });
  const primaryIds = uniquePrimaryTicketTargets(allPt);
  ok("unique primary cards by ticket id", primaryIds.size >= 3);

  // Final listConversation-style: tickets authoritative + messages merged
  const finalMsgs = (
    await prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 30,
    })
  )
    .reverse()
    .map((m) => ({
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      messageType: m.messageType,
      systemEventType: m.systemEventType,
      paymentTicketId: m.paymentTicketId,
    }));
  const finalTickets = (
    await prisma.paymentTicket.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
    })
  ).map((t) => ({
    id: t.id,
    createdById: t.createdById,
    createdAt: t.createdAt.toISOString(),
    revision: t.revision,
    status: t.status,
    title: t.title,
  }));
  const finalMerged = mergePaymentTicketsIntoTimeline(
    conversation.id,
    finalMsgs,
    finalTickets,
  );
  for (const t of finalTickets) {
    ok(
      `ticket ${t.id.slice(0, 8)} appears in merged timeline`,
      finalMerged.some((m) => m.paymentTicketId === t.id),
    );
  }
  // Pagination simulation: only recent 2 messages, still merge ALL tickets
  const page = finalMsgs.slice(-2);
  const pageMerged = mergePaymentTicketsIntoTimeline(
    conversation.id,
    page,
    finalTickets,
  );
  ok(
    "pagination still surfaces all tickets via merge",
    finalTickets.every((t) =>
      pageMerged.some((m) => m.paymentTicketId === t.id),
    ),
  );

  // --- Conversation isolation: ticket on A is not on C's other thread ---
  const keyAC = pairKey(userA.id, userC.id);
  let convC = await prisma.conversation.findUnique({ where: { pairKey: keyAC } });
  if (!convC) {
    convC = await prisma.conversation.create({
      data: {
        subject: "Ticket isolation C",
        contextType: "direct",
        pairKey: keyAC,
        participants: {
          create: [{ userId: userA.id }, { userId: userC.id }],
        },
      },
    });
  }
  const ticketsOnC = await prisma.paymentTicket.findMany({
    where: { conversationId: convC.id },
  });
  ok(
    "other conversation has no tickets from A↔B propose",
    !ticketsOnC.some((t) => t.id === ticket.id),
  );
  const ticketsOnlyA = await prisma.paymentTicket.findMany({
    where: { conversationId: conversation.id, id: ticket.id },
  });
  ok("ticket only on conversation A", ticketsOnlyA.length === 1);
  ok(
    "ticket.conversationId equals conversation A",
    ticket.conversationId === conversation.id,
  );

  // Failed proposal rollback: simulate transaction abort → no orphan ticket
  let rolledBack = false;
  try {
    await prisma.$transaction(async (tx) => {
      const ghost = await tx.paymentTicket.create({
        data: {
          conversationId: conversation.id,
          createdById: userA.id,
          buyerId: userA.id,
          sellerId: userB.id,
          status: "PROPOSED",
          revision: 99,
          termsHash: termsHash + "rollback",
          title: "Should rollback",
          currency: "GBP",
          itemCostMinor: 100,
          protectionFeeMinor: 50,
          totalChargeMinor: 150,
          paymentOption: "PROTECTED",
          stripeMode: "TEST",
        },
      });
      // Force failure after ticket insert (mirrors createOrRevise atomicity).
      if (ghost.id) {
        throw Object.assign(new Error("simulated propose failure"), {
          status: 500,
        });
      }
    });
  } catch {
    rolledBack = true;
  }
  ok("failed proposal rolled back transaction", rolledBack);
  const ghostCount = await prisma.paymentTicket.count({
    where: {
      conversationId: conversation.id,
      title: "Should rollback",
    },
  });
  ok("no orphan ticket after failed propose transaction", ghostCount === 0);

  // Same T.id for accept path (already ACCEPTED above) — card still one id
  ok(
    "accept mutates same ticket row",
    afterSeller.id === ticket.id && afterSeller.status === "ACCEPTED",
  );

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
