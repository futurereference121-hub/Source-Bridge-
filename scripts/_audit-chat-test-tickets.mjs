/**
 * READ-ONLY audit: classify chat Payment Tickets by authoritative payment env.
 * No DB writes. No Stripe creates (retrieve-only for livemode when keys present).
 *
 * Usage:
 *   node scripts/_audit-chat-test-tickets.mjs
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

const prisma = new PrismaClient();

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
  return MONEY_PT.includes(pt?.status || "");
}

function isCompleted(pt) {
  return COMPLETED_PT.includes(pt?.status || "");
}

function idLooksLive(id) {
  if (!id) return null;
  // Stripe object IDs themselves don't encode livemode; prefix only hints type.
  return null;
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
      return { livemode: Boolean(re.livemode), status: re.status, ok: true };
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return null;
}

async function main() {
  const liveFlag = env("LIVE_PAYMENTS_ENABLED").toLowerCase();
  const dbHost = (env("DATABASE_URL").match(/@([^/:]+)/) || [])[1] || "?";
  const stripeLive = stripeClient("LIVE");
  const stripeTest = stripeClient("TEST");

  console.log(
    JSON.stringify(
      {
        LIVE_PAYMENTS_ENABLED: liveFlag || "unset",
        dbHost,
        hasStripeLiveKey: Boolean(stripeLive),
        hasStripeTestKey: Boolean(stripeTest),
      },
      null,
      2,
    ),
  );

  const tickets = await prisma.paymentTicket.findMany({
    orderBy: { createdAt: "asc" },
  });
  const ptIds = [
    ...new Set(
      tickets.map((t) => t.protectedTransactionId).filter(Boolean),
    ),
  ];
  const pts = ptIds.length
    ? await prisma.protectedTransaction.findMany({
        where: { id: { in: ptIds } },
        include: {
          transferAttempts: { select: { stripeTransferId: true, stripeMode: true } },
          ledgerEntries: {
            where: {
              OR: [
                { stripeObjectType: "refund" },
                { stripeObjectType: "charge" },
                { stripeObjectType: "payment_intent" },
                { stripeObjectType: "transfer" },
              ],
            },
            select: {
              stripeObjectId: true,
              stripeObjectType: true,
              stripeMode: true,
              entryType: true,
            },
          },
        },
      })
    : [];
  const ptById = Object.fromEntries(pts.map((p) => [p.id, p]));

  // Product-checkout tickets must be excluded from mutation scope.
  const productCheckoutTxnIds = new Set(
    pts.filter((p) => p.origin === "PRODUCT_CHECKOUT").map((p) => p.id),
  );

  const reports = [];
  for (const t of tickets) {
    const pt = t.protectedTransactionId ? ptById[t.protectedTransactionId] : null;
    const ticketMode = modeOf(t.stripeMode);
    const ptMode = pt ? modeOf(pt.stripeMode) : null;
    const funded = isFunded(t, pt);
    const completed = isCompleted(pt);
    const isProductCheckout =
      Boolean(pt && pt.origin === "PRODUCT_CHECKOUT") ||
      Boolean(pt?.listingId && pt.origin === "PRODUCT_CHECKOUT");
    const isListedProduct =
      Boolean(pt?.origin === "PRODUCT_CHECKOUT") ||
      // Tickets created for product purchases still have listingId + PRODUCT origin
      (Boolean(pt?.listingId) && pt?.origin === "PRODUCT_CHECKOUT");

    const signals = {
      ticketStripeMode: ticketMode,
      ptStripeMode: ptMode,
      ledgerModes: [
        ...new Set((pt?.ledgerEntries || []).map((e) => modeOf(e.stripeMode))),
      ],
      transferModes: [
        ...new Set(
          (pt?.transferAttempts || []).map((a) => modeOf(a.stripeMode)),
        ),
      ],
      stripePeek: [],
    };

    // Authoritative Stripe livemode peeks (read-only). Prefer matching key first.
    const pi = pt?.stripePaymentIntentId || "";
    const ch = pt?.stripeChargeId || "";
    const transferIds = (pt?.transferAttempts || [])
      .map((a) => a.stripeTransferId)
      .filter(Boolean);
    const refundIds = (pt?.ledgerEntries || [])
      .filter((e) => e.entryType === "REFUND" || e.stripeObjectType === "refund")
      .map((e) => e.stripeObjectId)
      .filter(Boolean);

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

    if (funded || pi || ch) {
      await tryPeek("pi", pi);
      await tryPeek("ch", ch);
      for (const tid of transferIds.slice(0, 3)) await tryPeek("tr", tid);
      for (const rid of refundIds.slice(0, 3)) await tryPeek("re", rid);
    }

    const peekLive = signals.stripePeek.some((p) => p.ok && p.livemode === true);
    const peekTest = signals.stripePeek.some((p) => p.ok && p.livemode === false);
    const peekFail = signals.stripePeek.some((p) => p.ok === false);

    const modeSet = new Set(
      [ticketMode, ptMode, ...signals.ledgerModes, ...signals.transferModes].filter(
        Boolean,
      ),
    );
    if (peekLive) modeSet.add("LIVE");
    if (peekTest) modeSet.add("TEST");

    let envClass = "AMBIGUOUS";
    const reasons = [];

    if (isListedProduct || isProductCheckout) {
      envClass = "LISTED_PRODUCT";
      reasons.push("PRODUCT_CHECKOUT origin — out of scope");
    } else if (modeSet.has("LIVE") && modeSet.has("TEST")) {
      envClass = "AMBIGUOUS";
      reasons.push("conflicting LIVE+TEST signals");
    } else if (peekLive || modeSet.has("LIVE")) {
      // LIVE wins if any authoritative LIVE signal and no TEST conflict
      if (peekTest && peekLive) {
        envClass = "AMBIGUOUS";
        reasons.push("Stripe peeks disagree livemode");
      } else if (modeSet.has("TEST") && !peekLive) {
        envClass = "AMBIGUOUS";
        reasons.push("DB modes include TEST but also LIVE label");
      } else {
        envClass = "LIVE";
        reasons.push(peekLive ? "Stripe livemode=true" : "stripeMode=LIVE");
      }
    } else if (modeSet.has("TEST") || modeSet.size === 0) {
      // Pure TEST (or default TEST with no PT)
      if (funded && completed) envClass = "COMPLETED_TEST";
      else if (funded) envClass = "FUNDED_TEST";
      else envClass = "UNFUNDED_TEST";
      reasons.push("stripeMode=TEST (or default) with no LIVE signals");
    } else {
      envClass = "AMBIGUOUS";
      reasons.push("unable to classify");
    }

    // Extra guard: funded with PI that failed both peeks → AMBIGUOUS if we can't confirm
    if (
      (envClass === "FUNDED_TEST" ||
        envClass === "COMPLETED_TEST" ||
        envClass === "UNFUNDED_TEST") &&
      funded &&
      (pi || ch) &&
      peekFail &&
      !peekTest &&
      !peekLive
    ) {
      envClass = "AMBIGUOUS";
      reasons.push("funded with Stripe IDs but livemode peek failed");
    }

    reports.push({
      ticketId: t.id,
      conversationId: t.conversationId,
      status: t.status,
      title: t.title,
      protectedTransactionId: t.protectedTransactionId,
      protectedStatus: pt?.status ?? null,
      origin: pt?.origin ?? null,
      listingId: pt?.listingId ?? t.listingId ?? null,
      funded,
      completed,
      hiddenFromChatAt: t.hiddenFromChatAt,
      envClass,
      reasons,
      signals,
      knownLiveTxn:
        t.protectedTransactionId === KNOWN_LIVE_TXN ||
        pt?.id === KNOWN_LIVE_TXN,
    });
  }

  const counts = {
    TOTAL: reports.length,
    LIVE: reports.filter((r) => r.envClass === "LIVE").length,
    TEST:
      reports.filter((r) =>
        ["UNFUNDED_TEST", "FUNDED_TEST", "COMPLETED_TEST"].includes(r.envClass),
      ).length,
    UNFUNDED_TEST: reports.filter((r) => r.envClass === "UNFUNDED_TEST").length,
    FUNDED_TEST: reports.filter((r) => r.envClass === "FUNDED_TEST").length,
    COMPLETED_TEST: reports.filter((r) => r.envClass === "COMPLETED_TEST")
      .length,
    AMBIGUOUS: reports.filter((r) => r.envClass === "AMBIGUOUS").length,
    LISTED_PRODUCT: reports.filter((r) => r.envClass === "LISTED_PRODUCT")
      .length,
    ALREADY_HIDDEN: reports.filter((r) => r.hiddenFromChatAt).length,
    KNOWN_LIVE_PRESENT: reports.some((r) => r.knownLiveTxn),
  };

  const liveTxns = [
    ...new Set(
      reports
        .filter((r) => r.envClass === "LIVE" && r.protectedTransactionId)
        .map((r) => r.protectedTransactionId),
    ),
  ];

  const out = {
    counts,
    liveProtectedTxnIds: liveTxns,
    knownLiveTxnPreserved: liveTxns.includes(KNOWN_LIVE_TXN),
    ambiguous: reports
      .filter((r) => r.envClass === "AMBIGUOUS")
      .map((r) => ({
        ticketId: r.ticketId,
        protectedTransactionId: r.protectedTransactionId,
        reasons: r.reasons,
        signals: r.signals,
      })),
    live: reports
      .filter((r) => r.envClass === "LIVE")
      .map((r) => ({
        ticketId: r.ticketId,
        protectedTransactionId: r.protectedTransactionId,
        status: r.status,
        protectedStatus: r.protectedStatus,
        knownLiveTxn: r.knownLiveTxn,
        hiddenFromChatAt: r.hiddenFromChatAt,
      })),
    unfundedTest: reports
      .filter((r) => r.envClass === "UNFUNDED_TEST")
      .map((r) => ({
        ticketId: r.ticketId,
        status: r.status,
        hiddenFromChatAt: r.hiddenFromChatAt,
        conversationId: r.conversationId,
      })),
    fundedTest: reports
      .filter((r) => r.envClass === "FUNDED_TEST")
      .map((r) => ({
        ticketId: r.ticketId,
        protectedTransactionId: r.protectedTransactionId,
        status: r.status,
        protectedStatus: r.protectedStatus,
        hiddenFromChatAt: r.hiddenFromChatAt,
      })),
    completedTest: reports
      .filter((r) => r.envClass === "COMPLETED_TEST")
      .map((r) => ({
        ticketId: r.ticketId,
        protectedTransactionId: r.protectedTransactionId,
        status: r.status,
        protectedStatus: r.protectedStatus,
        hiddenFromChatAt: r.hiddenFromChatAt,
      })),
    listedProduct: reports
      .filter((r) => r.envClass === "LISTED_PRODUCT")
      .map((r) => ({
        ticketId: r.ticketId,
        protectedTransactionId: r.protectedTransactionId,
        origin: r.origin,
      })),
  };

  writeFileSync(
    ".cursor/_chat_ticket_audit.json",
    JSON.stringify(out, null, 2),
  );
  console.log("\n=== COUNTS ===");
  console.log(JSON.stringify(counts, null, 2));
  console.log("\nLIVE txn ids:", liveTxns);
  console.log("known LIVE present:", out.knownLiveTxnPreserved);
  console.log("AMBIGUOUS:", out.ambiguous.length);
  console.log("Wrote .cursor/_chat_ticket_audit.json");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
