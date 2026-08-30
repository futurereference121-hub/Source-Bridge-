/**
 * Chat cleanup: remove unfunded TEST Payment Tickets; hide funded/completed TEST.
 * Classify by authoritative payment environment (stripeMode, Connect mode,
 * Stripe livemode peek when keys exist) — never by username.
 *
 * Does not create Stripe money objects. Does not touch PRODUCT_CHECKOUT.
 * Does not mutate LIVE or AMBIGUOUS rows.
 *
 *   node scripts/_cleanup-chat-test-tickets.mjs           # dry-run
 *   node scripts/_cleanup-chat-test-tickets.mjs --execute # mutate
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import Stripe from "stripe";

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

const KNOWN_LIVE_TXN = "cmtcipey60003km0a86vyv54w";
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
const COMPLETED_PT = ["RELEASED", "REFUNDED", "PARTIALLY_REFUNDED"];
const MONEY_LEDGER = [
  "CHARGE",
  "PROCUREMENT_TRANSFER",
  "FINAL_TRANSFER",
  "REFUND",
];

const prisma = new PrismaClient();
const EXECUTE =
  process.argv.includes("--execute") && !process.argv.includes("--dry-run");

function env(name) {
  return (process.env[name] || "").trim();
}

function modeOf(v) {
  return String(v || "TEST").toUpperCase() === "LIVE" ? "LIVE" : "TEST";
}

function stripeClient(kind) {
  const liveKey = env("STRIPE_SECRET_KEY_LIVE");
  const testKey =
    env("STRIPE_SECRET_KEY_TEST") ||
    (env("STRIPE_SECRET_KEY").startsWith("sk_test_")
      ? env("STRIPE_SECRET_KEY")
      : "");
  const key = kind === "LIVE" ? liveKey : testKey;
  if (!key) return null;
  if (kind === "LIVE" && !key.startsWith("sk_live_")) return null;
  if (kind === "TEST" && !key.startsWith("sk_test_")) return null;
  return new Stripe(key, { apiVersion: "2026-07-29.dahlia" });
}

function isFunded(t, pt) {
  if (t.status === "FUNDED") return true;
  if (pt?.fundedAt) return true;
  if ((pt?.procurementTransferredMinor ?? 0) > 0) return true;
  if ((pt?.finalTransferredMinor ?? 0) > 0) return true;
  if ((pt?.refundedMinor ?? 0) > 0) return true;
  if (MONEY_PT.includes(pt?.status || "")) return true;
  const ledgers = pt?.ledgerEntries || [];
  if (
    ledgers.some(
      (e) => MONEY_LEDGER.includes(e.entryType) && (e.amountMinor ?? 0) > 0,
    )
  ) {
    return true;
  }
  return false;
}

function isCompleted(pt) {
  return COMPLETED_PT.includes(pt?.status || "");
}

async function peekLivemode(stripe, type, id) {
  if (!stripe || !id) return null;
  try {
    if (type === "pi") {
      const pi = await stripe.paymentIntents.retrieve(id);
      return { livemode: Boolean(pi.livemode), status: pi.status, ok: true };
    }
    if (type === "ch") {
      const ch = await stripe.charges.retrieve(id);
      return { livemode: Boolean(ch.livemode), status: ch.status, ok: true };
    }
    if (type === "tr") {
      const tr = await stripe.transfers.retrieve(id);
      return { livemode: Boolean(tr.livemode), ok: true };
    }
    if (type === "re") {
      const re = await stripe.refunds.retrieve(id);
      return { livemode: Boolean(re.livemode), ok: true };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return null;
}

function hasLiveSignal(signals) {
  if (signals.ticketStripeMode === "LIVE") return true;
  if (signals.ptStripeMode === "LIVE") return true;
  if (signals.connectMode === "LIVE") return true;
  if ((signals.ledgerModes || []).includes("LIVE")) return true;
  if ((signals.transferModes || []).includes("LIVE")) return true;
  if ((signals.stripePeek || []).some((p) => p.ok && p.livemode === true)) {
    return true;
  }
  return false;
}

async function classifyTicket(t, pt, connectModeByAcct, stripeLive, stripeTest) {
  const ticketMode = modeOf(t.stripeMode);
  const ptMode = pt ? modeOf(pt.stripeMode) : null;
  const funded = isFunded(t, pt);
  const completed = isCompleted(pt);
  const isListed = pt?.origin === "PRODUCT_CHECKOUT";
  const connectMode = pt?.sellerConnectAccountId
    ? connectModeByAcct.get(pt.sellerConnectAccountId) || null
    : null;

  const signals = {
    ticketStripeMode: ticketMode,
    ptStripeMode: ptMode,
    connectMode,
    ledgerModes: [
      ...new Set((pt?.ledgerEntries || []).map((e) => modeOf(e.stripeMode))),
    ],
    transferModes: [
      ...new Set((pt?.transferAttempts || []).map((a) => modeOf(a.stripeMode))),
    ],
    stripePeek: [],
    pi: pt?.stripePaymentIntentId || "",
    charge: pt?.stripeChargeId || "",
  };

  const preferred = ptMode || ticketMode;
  const primary = preferred === "LIVE" ? stripeLive : stripeTest;
  const secondary = preferred === "LIVE" ? stripeTest : stripeLive;

  async function tryPeek(type, id) {
    if (!id) return;
    let r = await peekLivemode(primary, type, id);
    if (r && r.ok === false && secondary) {
      const r2 = await peekLivemode(secondary, type, id);
      if (r2 && r2.ok) r = { ...r2, viaSecondary: true };
    }
    if (r) signals.stripePeek.push({ type, id, ...r });
  }

  if (funded || signals.pi || signals.charge) {
    await tryPeek("pi", signals.pi);
    await tryPeek("ch", signals.charge);
    for (const a of (pt?.transferAttempts || []).slice(0, 3)) {
      if (a.stripeTransferId) await tryPeek("tr", a.stripeTransferId);
    }
    for (const e of (pt?.ledgerEntries || []).filter(
      (x) => x.entryType === "REFUND" || x.stripeObjectType === "refund",
    ).slice(0, 3)) {
      if (e.stripeObjectId) await tryPeek("re", e.stripeObjectId);
    }
  }

  const peekLive = signals.stripePeek.some((p) => p.ok && p.livemode === true);
  const peekTest = signals.stripePeek.some((p) => p.ok && p.livemode === false);
  const peekFail = signals.stripePeek.some((p) => p.ok === false);
  const live = hasLiveSignal(signals) || peekLive;
  const testModes = new Set(
    [ticketMode, ptMode, connectMode, ...signals.ledgerModes, ...signals.transferModes].filter(
      (m) => m === "TEST",
    ),
  );

  let envClass = "AMBIGUOUS";
  const reasons = [];

  if (isListed) {
    envClass = "LISTED_PRODUCT";
    reasons.push("PRODUCT_CHECKOUT origin — out of scope");
  } else if (live && (peekTest && peekLive)) {
    envClass = "AMBIGUOUS";
    reasons.push("Stripe peeks disagree livemode");
  } else if (live && testModes.size && !peekLive && ticketMode === "TEST" && ptMode === "LIVE") {
    envClass = "AMBIGUOUS";
    reasons.push("ticket TEST vs PT LIVE");
  } else if (live && ticketMode === "LIVE" && ptMode === "TEST") {
    envClass = "AMBIGUOUS";
    reasons.push("ticket LIVE vs PT TEST");
  } else if (live) {
    envClass = "LIVE";
    reasons.push(peekLive ? "Stripe livemode=true" : "stored stripeMode/Connect=LIVE");
  } else if (funded && (signals.pi || signals.charge) && peekFail && !peekTest) {
    envClass = "AMBIGUOUS";
    reasons.push("funded Stripe IDs but livemode peek failed");
  } else {
    if (funded && completed) envClass = "COMPLETED_TEST";
    else if (funded) envClass = "FUNDED_TEST";
    else envClass = "UNFUNDED_TEST";
    reasons.push("TEST environment with no LIVE signals");
  }

  return {
    ticketId: t.id,
    conversationId: t.conversationId,
    status: t.status,
    title: t.title,
    protectedTransactionId: t.protectedTransactionId,
    protectedStatus: pt?.status ?? null,
    origin: pt?.origin ?? null,
    funded,
    completed,
    hiddenFromChatAt: t.hiddenFromChatAt,
    envClass,
    reasons,
    signals,
    knownLiveTxn: t.protectedTransactionId === KNOWN_LIVE_TXN,
  };
}

async function main() {
  const stripeLive = stripeClient("LIVE");
  const stripeTest = stripeClient("TEST");
  const dbHost = (env("DATABASE_URL").match(/@([^/:]+)/) || [])[1] || "?";

  const tickets = await prisma.paymentTicket.findMany({
    orderBy: { createdAt: "asc" },
  });
  const ptIds = [
    ...new Set(tickets.map((t) => t.protectedTransactionId).filter(Boolean)),
  ];
  const pts = ptIds.length
    ? await prisma.protectedTransaction.findMany({
        where: { id: { in: ptIds } },
        include: {
          transferAttempts: {
            select: {
              stripeTransferId: true,
              stripeMode: true,
            },
          },
          ledgerEntries: {
            select: {
              stripeObjectId: true,
              stripeObjectType: true,
              stripeMode: true,
              entryType: true,
              amountMinor: true,
            },
          },
        },
      })
    : [];
  const ptById = Object.fromEntries(pts.map((p) => [p.id, p]));

  const connectRows = await prisma.stripeConnectAccount.findMany({
    select: { stripeAccountId: true, stripeMode: true },
  });
  const connectModeByAcct = new Map(
    connectRows
      .filter((c) => c.stripeAccountId)
      .map((c) => [c.stripeAccountId, modeOf(c.stripeMode)]),
  );

  const reports = [];
  for (const t of tickets) {
    const pt = t.protectedTransactionId ? ptById[t.protectedTransactionId] : null;
    reports.push(
      await classifyTicket(t, pt, connectModeByAcct, stripeLive, stripeTest),
    );
  }

  const liveTxns = [
    ...new Set(
      reports
        .filter((r) => r.envClass === "LIVE" && r.protectedTransactionId)
        .map((r) => r.protectedTransactionId),
    ),
  ];

  const listedBefore = await prisma.protectedTransaction.findMany({
    where: { origin: "PRODUCT_CHECKOUT" },
    select: { id: true, status: true, stripeMode: true, updatedAt: true },
  });

  const liveLedgerBefore = await prisma.ledgerEntry.count({
    where: { stripeMode: "LIVE" },
  });

  const counts = {
    TOTAL: reports.length,
    LIVE: reports.filter((r) => r.envClass === "LIVE").length,
    TEST: reports.filter((r) =>
      ["UNFUNDED_TEST", "FUNDED_TEST", "COMPLETED_TEST"].includes(r.envClass),
    ).length,
    UNFUNDED_TEST: reports.filter((r) => r.envClass === "UNFUNDED_TEST").length,
    FUNDED_TEST: reports.filter((r) => r.envClass === "FUNDED_TEST").length,
    COMPLETED_TEST: reports.filter((r) => r.envClass === "COMPLETED_TEST")
      .length,
    AMBIGUOUS: reports.filter((r) => r.envClass === "AMBIGUOUS").length,
    LISTED_PRODUCT: reports.filter((r) => r.envClass === "LISTED_PRODUCT")
      .length,
  };

  if (!liveTxns.includes(KNOWN_LIVE_TXN)) {
    throw new Error(
      `ABORT: known LIVE txn ${KNOWN_LIVE_TXN} not classified LIVE (found: ${liveTxns.join(",")})`,
    );
  }

  const deleteUnfunded = reports.filter((r) => r.envClass === "UNFUNDED_TEST");
  const hideFunded = reports.filter(
    (r) => r.envClass === "FUNDED_TEST" && !r.hiddenFromChatAt,
  );
  const hideCompleted = reports.filter(
    (r) => r.envClass === "COMPLETED_TEST" && !r.hiddenFromChatAt,
  );
  const alreadyHiddenFunded = reports.filter(
    (r) =>
      (r.envClass === "FUNDED_TEST" || r.envClass === "COMPLETED_TEST") &&
      r.hiddenFromChatAt,
  );

  const ticketIdsForNotifs = [
    ...deleteUnfunded.map((r) => r.ticketId),
    ...hideFunded.map((r) => r.ticketId),
    ...hideCompleted.map((r) => r.ticketId),
    ...alreadyHiddenFunded.map((r) => r.ticketId),
  ];
  const txnIdsForNotifs = [
    ...deleteUnfunded,
    ...hideFunded,
    ...hideCompleted,
    ...alreadyHiddenFunded,
  ]
    .map((r) => r.protectedTransactionId)
    .filter(Boolean);

  const notifOr = [];
  for (const id of ticketIdsForNotifs) {
    notifOr.push({ href: { contains: `ticket=${id}` } });
    notifOr.push({ dedupeKey: { startsWith: `pt-proposed:${id}` } });
    notifOr.push({ dedupeKey: { startsWith: `pt-accepted:${id}` } });
    notifOr.push({ dedupeKey: { equals: `pt-both-accepted:${id}` } });
  }
  for (const id of txnIdsForNotifs) {
    notifOr.push({ href: { contains: id } });
    notifOr.push({ dedupeKey: { contains: id } });
  }

  const notifs = notifOr.length
    ? await prisma.notification.findMany({
        where: { OR: notifOr },
        select: { id: true, type: true, dedupeKey: true, href: true, userId: true },
      })
    : [];

  const liveNotifHit = notifs.filter((n) => {
    const blob = `${n.dedupeKey || ""} ${n.href || ""}`;
    return liveTxns.some((id) => blob.includes(id)) ||
      reports
        .filter((r) => r.envClass === "LIVE")
        .some((r) => blob.includes(r.ticketId));
  });

  const safeNotifs = notifs.filter((n) => !liveNotifHit.some((l) => l.id === n.id));

  const plan = {
    execute: EXECUTE,
    dbHost,
    hasStripeLiveKey: Boolean(stripeLive),
    hasStripeTestKey: Boolean(stripeTest),
    counts,
    liveProtectedTxnIds: liveTxns,
    knownLivePreserved: true,
    deleteUnfundedTicketIds: deleteUnfunded.map((r) => r.ticketId),
    hideFundedTicketIds: hideFunded.map((r) => r.ticketId),
    hideCompletedTicketIds: hideCompleted.map((r) => r.ticketId),
    alreadyHiddenMoneyTest: alreadyHiddenFunded.length,
    notificationsToDelete: safeNotifs.length,
    liveNotificationsSkipped: liveNotifHit.length,
    listedProductTxnIds: listedBefore.map((p) => p.id),
    liveLedgerBefore,
    ambiguous: reports.filter((r) => r.envClass === "AMBIGUOUS"),
  };

  writeFileSync(
    ".cursor/_chat_ticket_cleanup_plan.json",
    JSON.stringify(plan, null, 2),
  );
  console.log(JSON.stringify({ ...plan, ambiguous: plan.ambiguous }, null, 2));

  if (plan.ambiguous.length) {
    throw new Error("ABORT: AMBIGUOUS tickets present — no mutation");
  }

  const livePiHay = reports
    .filter((r) => r.envClass === "LIVE")
    .flatMap((r) => [r.signals?.pi, r.signals?.charge])
    .filter(Boolean);
  const livePiToken =
    livePiHay.length >= 2
      ? (() => {
          const a = livePiHay[0];
          let best = "";
          for (let i = 0; i < a.length; i += 1) {
            for (let j = i + 8; j <= a.length; j += 1) {
              const sub = a.slice(i, j);
              if (
                livePiHay.every((p) => p.includes(sub)) &&
                sub.length > best.length
              ) {
                best = sub;
              }
            }
          }
          return best;
        })()
      : "";

  for (const r of [...deleteUnfunded, ...hideFunded, ...hideCompleted]) {
    if (r.envClass === "LIVE" || r.knownLiveTxn) {
      throw new Error(`ABORT: attempted mutate of LIVE ticket ${r.ticketId}`);
    }
    if (hasLiveSignal(r.signals)) {
      throw new Error(`ABORT: LIVE signal on ${r.ticketId}`);
    }
    if (r.origin === "PRODUCT_CHECKOUT") {
      throw new Error(`ABORT: listed product ticket ${r.ticketId}`);
    }
    if (liveTxns.includes(r.protectedTransactionId)) {
      throw new Error(`ABORT: LIVE txn on ${r.ticketId}`);
    }
    const pi = r.signals?.pi || "";
    const ch = r.signals?.charge || "";
    if (livePiToken && (pi.includes(livePiToken) || ch.includes(livePiToken))) {
      throw new Error(
        `ABORT: Stripe object matches LIVE platform token on ${r.ticketId}`,
      );
    }
    if (livePiHay.includes(pi) || livePiHay.includes(ch)) {
      throw new Error(`ABORT: Stripe id overlaps LIVE set on ${r.ticketId}`);
    }
  }

  if (!EXECUTE) {
    console.log("\nDry-run only. Re-run with --execute to apply.");
    return;
  }

  const now = new Date();
  const results = {
    deletedTickets: [],
    deletedMessages: 0,
    cancelledUnfundedPts: [],
    hiddenTickets: [],
    deletedNotifications: 0,
    bumpedConversations: [],
  };

  const convTouch = new Set();

  for (const r of deleteUnfunded) {
    const pt = r.protectedTransactionId ? ptById[r.protectedTransactionId] : null;
    await prisma.$transaction(async (tx) => {
      const msgDel = await tx.message.deleteMany({
        where: { paymentTicketId: r.ticketId },
      });
      results.deletedMessages += msgDel.count;
      await tx.paymentTicket.update({
        where: { id: r.ticketId },
        data: { protectedTransactionId: null },
      });
      await tx.paymentTicket.delete({ where: { id: r.ticketId } });
      if (
        pt &&
        !pt.fundedAt &&
        (pt.procurementTransferredMinor ?? 0) === 0 &&
        (pt.finalTransferredMinor ?? 0) === 0 &&
        (pt.refundedMinor ?? 0) === 0 &&
        modeOf(pt.stripeMode) !== "LIVE" &&
        pt.origin !== "PRODUCT_CHECKOUT" &&
        !MONEY_PT.includes(pt.status)
      ) {
        if (
          ["ACCEPTED", "AWAITING_PAYMENT", "DRAFT", "AWAITING_ACCEPTANCE"].includes(
            pt.status,
          )
        ) {
          await tx.protectedTransaction.update({
            where: { id: pt.id },
            data: { status: "CANCELLED", cancelledAt: now },
          });
          results.cancelledUnfundedPts.push(pt.id);
        }
      }
    });
    results.deletedTickets.push(r.ticketId);
    convTouch.add(r.conversationId);
  }

  const hideIds = [...hideFunded, ...hideCompleted].map((r) => r.ticketId);
  if (hideIds.length) {
    await prisma.paymentTicket.updateMany({
      where: { id: { in: hideIds } },
      data: { hiddenFromChatAt: now },
    });
    results.hiddenTickets = hideIds;
    for (const r of [...hideFunded, ...hideCompleted]) {
      convTouch.add(r.conversationId);
    }
  }

  if (safeNotifs.length) {
    const del = await prisma.notification.deleteMany({
      where: { id: { in: safeNotifs.map((n) => n.id) } },
    });
    results.deletedNotifications = del.count;
  }

  for (const convId of convTouch) {
    await prisma.conversation.update({
      where: { id: convId },
      data: {
        lastMessageAt: now,
        updatedAt: now,
        activityVersion: { increment: 1 },
      },
    });
    results.bumpedConversations.push(convId);
  }

  const listedAfter = await prisma.protectedTransaction.findMany({
    where: { origin: "PRODUCT_CHECKOUT" },
    select: { id: true, status: true, stripeMode: true, updatedAt: true },
  });
  const liveLedgerAfter = await prisma.ledgerEntry.count({
    where: { stripeMode: "LIVE" },
  });
  const knownLive = await prisma.protectedTransaction.findUnique({
    where: { id: KNOWN_LIVE_TXN },
    include: { paymentTicket: { select: { id: true, hiddenFromChatAt: true, status: true } } },
  });
  const remainingLiveTickets = await prisma.paymentTicket.count({
    where: { stripeMode: "LIVE", hiddenFromChatAt: null },
  });

  const listedChanged =
    JSON.stringify(listedBefore.map((p) => p.id).sort()) !==
    JSON.stringify(listedAfter.map((p) => p.id).sort());

  const out = {
    ...results,
    listedProductUnchanged: !listedChanged,
    liveLedgerUnchanged: liveLedgerBefore === liveLedgerAfter,
    knownLiveTicket: knownLive?.paymentTicket,
    remainingVisibleLiveTickets: remainingLiveTickets,
  };
  writeFileSync(
    ".cursor/_chat_ticket_cleanup_result.json",
    JSON.stringify(out, null, 2),
  );
  console.log("\n=== APPLIED ===");
  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
