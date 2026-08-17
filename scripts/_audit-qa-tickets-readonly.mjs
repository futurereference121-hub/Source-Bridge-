/**
 * READ-ONLY audit of Payment Tickets involving the three QA accounts.
 * Does not update/insert/delete. Does not create Stripe money objects.
 * Run: node scripts/_audit-qa-tickets-readonly.mjs
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

function loadEnv(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return;
  }
  raw = raw.replace(/^\uFEFF/, "");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key]) continue;
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (/^\[sensitive\]$/i.test(val)) continue;
    process.env[key] = val;
  }
}
loadEnv(".env");
loadEnv(".env.local");
loadEnv(".env.stripe.tmp");

const prisma = new PrismaClient();

const QA = {
  futureman: "cms8or23a0000la046qm6ene4",
  theowlsaid: "cms62cfan0000ih04giwg7ee3",
  bellahap: "cms5zjfcn0000l9049tjkbd0m",
};
const QA_IDS = Object.values(QA);

function who(id) {
  for (const [name, uid] of Object.entries(QA)) {
    if (uid === id) return name;
  }
  return id;
}

const UNFUNDED_HIDDEN = [
  "CANCELLED",
  "DECLINED",
  "SUPERSEDED",
  "VOIDED",
  "DELETED",
  "EXPIRED",
];
const ACTIVE_TICKET = ["DRAFT", "PROPOSED", "ACCEPTED", "FUNDED"];
const MONEY_PT = [
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

function classify(t, pt) {
  const funded = Boolean(
    t.status === "FUNDED" ||
      pt?.fundedAt ||
      MONEY_PT.includes(pt?.status || "") ||
      (pt?.procurementTransferredMinor ?? 0) > 0 ||
      (pt?.finalTransferredMinor ?? 0) > 0 ||
      (pt?.refundedMinor ?? 0) > 0,
  );
  const completed =
    pt?.status === "RELEASED" ||
    pt?.status === "REFUNDED" ||
    pt?.status === "PARTIALLY_REFUNDED";
  let bucket = "A_UNFUNDED";
  if (completed) bucket = "C_COMPLETED";
  else if (funded) bucket = "B_FUNDED";
  const appearsInChat = t.hiddenFromChatAt
    ? false
    : UNFUNDED_HIDDEN.includes(t.status)
      ? funded
      : true;
  const countsActive =
    !t.hiddenFromChatAt &&
    ACTIVE_TICKET.includes(t.status) &&
    !UNFUNDED_HIDDEN.includes(t.status) &&
    pt?.status !== "RELEASED" &&
    pt?.status !== "REFUNDED" &&
    pt?.status !== "PARTIALLY_REFUNDED" &&
    pt?.status !== "CANCELLED";
  return { funded, completed, bucket, appearsInChat, countsActive, hiddenFromChatAt: t.hiddenFromChatAt };
}

async function main() {
  console.log("FLAGS", {
    LIVE_PAYMENTS_ENABLED: (process.env.LIVE_PAYMENTS_ENABLED || "").trim() || "unset",
  });

  const tickets = await prisma.paymentTicket.findMany({
    where: {
      OR: [
        { buyerId: { in: QA_IDS } },
        { sellerId: { in: QA_IDS } },
        { createdById: { in: QA_IDS } },
      ],
    },
    orderBy: { createdAt: "asc" },
  });

  const ptIds = tickets.map((t) => t.protectedTransactionId).filter(Boolean);
  const pts = ptIds.length
    ? await prisma.protectedTransaction.findMany({
        where: { id: { in: ptIds } },
      })
    : [];
  const ptById = Object.fromEntries(pts.map((p) => [p.id, p]));

  const convIds = [...new Set(tickets.map((t) => t.conversationId))];
  const reports = tickets.map((t) => {
    const pt = t.protectedTransactionId ? ptById[t.protectedTransactionId] : null;
    const ui = classify(t, pt);
    return {
      ticketId: t.id,
      conversationId: t.conversationId,
      createdAt: t.createdAt,
      createdBy: who(t.createdById),
      buyer: who(t.buyerId),
      seller: who(t.sellerId),
      title: t.title,
      ticketStatus: t.status,
      stripeMode: t.stripeMode,
      protectedTransactionId: t.protectedTransactionId,
      protectedStatus: pt?.status ?? null,
      fundedAt: pt?.fundedAt ?? null,
      shippedAt: pt?.shippedAt ?? null,
      deliveredAt: pt?.deliveredAt ?? null,
      stripePaymentIntentId: pt?.stripePaymentIntentId || null,
      stripeChargeId: pt?.stripeChargeId || null,
      procurementTransferredMinor: pt?.procurementTransferredMinor ?? 0,
      finalTransferredMinor: pt?.finalTransferredMinor ?? 0,
      refundedMinor: pt?.refundedMinor ?? 0,
      totalChargeMinor: t.totalChargeMinor,
      currency: t.currency,
      ...ui,
    };
  });

  const byBucket = { A_UNFUNDED: [], B_FUNDED: [], C_COMPLETED: [] };
  for (const r of reports) byBucket[r.bucket].push(r);

  const visible = reports.filter((r) => r.appearsInChat);
  const active = reports.filter((r) => r.countsActive);

  console.log("\n=== SUMMARY ===");
  console.log(
    JSON.stringify(
      {
        totalTickets: reports.length,
        conversations: convIds.length,
        A_unfunded: byBucket.A_UNFUNDED.length,
        B_funded: byBucket.B_FUNDED.length,
        C_completed: byBucket.C_COMPLETED.length,
        currentlyVisibleInChat: visible.length,
        currentlyCountingActive: active.length,
      },
      null,
      2,
    ),
  );

  console.log("\n=== BY CONVERSATION (visible / active) ===");
  const byConv = {};
  for (const r of reports) {
    if (!byConv[r.conversationId]) {
      byConv[r.conversationId] = { tickets: 0, visible: 0, active: 0, parties: new Set() };
    }
    byConv[r.conversationId].tickets += 1;
    if (r.appearsInChat) byConv[r.conversationId].visible += 1;
    if (r.countsActive) byConv[r.conversationId].active += 1;
    byConv[r.conversationId].parties.add(r.buyer);
    byConv[r.conversationId].parties.add(r.seller);
  }
  console.log(
    JSON.stringify(
      Object.entries(byConv).map(([id, v]) => ({
        conversationId: id,
        parties: [...v.parties],
        tickets: v.tickets,
        visible: v.visible,
        active: v.active,
      })),
      null,
      2,
    ),
  );

  console.log("\n=== TICKETS ===");
  console.log(
    JSON.stringify(
      reports.map((r) => ({
        ticketId: r.ticketId,
        conversationId: r.conversationId,
        buyer: r.buyer,
        seller: r.seller,
        ticketStatus: r.ticketStatus,
        protectedStatus: r.protectedStatus,
        bucket: r.bucket,
        hiddenFromChatAt: r.hiddenFromChatAt,
        appearsInChat: r.appearsInChat,
        countsActive: r.countsActive,
        fundedAt: r.fundedAt,
        pi: r.stripePaymentIntentId,
        charge: r.stripeChargeId,
        totalChargeMinor: r.totalChargeMinor,
      })),
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
