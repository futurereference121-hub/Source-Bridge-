/**
 * QA reset: hide/cancel Payment Tickets involving the three TEST QA accounts.
 * Does not delete funded PT / PI / Charge / TransferAttempt / ledger rows.
 * Does not create Charge / Transfer / Refund. May cancel incomplete unfunded PIs.
 *
 * Guards: LIVE_PAYMENTS_ENABLED must not be true; Stripe TEST keys only.
 *
 * Dry-run (default):
 *   node scripts/_qa-reset-tickets.mjs
 *   node scripts/_qa-reset-tickets.mjs --dry-run
 * Execute:
 *   node scripts/_qa-reset-tickets.mjs --execute
 */
import { readFileSync } from "node:fs";
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

const prisma = new PrismaClient();

const QA_IDS = [
  "cms8or23a0000la046qm6ene4", // futureman
  "cms62cfan0000ih04giwg7ee3", // theowlsaid
  "cms5zjfcn0000l9049tjkbd0m", // bellahap
];

const UNFUNDED_OPEN = ["DRAFT", "PROPOSED", "ACCEPTED"];
const PI_CANCELABLE = [
  "requires_payment_method",
  "requires_confirmation",
  "requires_action",
  "requires_capture",
];

function env(name) {
  return (process.env[name] || "").trim();
}

function stripeTest() {
  const key = env("STRIPE_SECRET_KEY_TEST") || env("STRIPE_SECRET_KEY");
  if (!key.startsWith("sk_test_")) return null;
  return new Stripe(key, { apiVersion: "2026-07-29.dahlia" });
}

function isFunded(t, pt) {
  if (t.status === "FUNDED") return true;
  if (pt?.fundedAt) return true;
  if ((pt?.procurementTransferredMinor ?? 0) > 0) return true;
  if ((pt?.finalTransferredMinor ?? 0) > 0) return true;
  if ((pt?.refundedMinor ?? 0) > 0) return true;
  const st = pt?.status || "";
  return [
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
  ].includes(st);
}

async function main() {
const execute =
  process.argv.includes("--execute") && !process.argv.includes("--dry-run");
  const live = env("LIVE_PAYMENTS_ENABLED").toLowerCase();
  if (live === "true" || live === "1") {
    throw new Error("Refusing QA reset while LIVE_PAYMENTS_ENABLED is true");
  }

  const stripe = stripeTest();
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

  const plan = [];
  for (const t of tickets) {
    if ((t.stripeMode || "TEST").toUpperCase() === "LIVE") {
      plan.push({ ticketId: t.id, action: "SKIP_LIVE_MODE" });
      continue;
    }
    const pt = t.protectedTransactionId ? ptById[t.protectedTransactionId] : null;
    if (pt && (pt.stripeMode || "TEST").toUpperCase() === "LIVE") {
      plan.push({ ticketId: t.id, action: "SKIP_LIVE_PT" });
      continue;
    }
    if (t.hiddenFromChatAt) {
      plan.push({ ticketId: t.id, action: "ALREADY_HIDDEN", status: t.status });
      continue;
    }
    if (isFunded(t, pt)) {
      plan.push({
        ticketId: t.id,
        action: "HIDE_FUNDED",
        ticketStatus: t.status,
        protectedStatus: pt?.status ?? null,
        pi: pt?.stripePaymentIntentId || null,
        charge: pt?.stripeChargeId || null,
      });
      continue;
    }
    plan.push({
      ticketId: t.id,
      action: UNFUNDED_OPEN.includes(t.status) ? "EXPIRE_UNFUNDED" : "HIDE_UNFUNDED_TERMINAL",
      ticketStatus: t.status,
      protectedStatus: pt?.status ?? null,
      pi: pt?.stripePaymentIntentId || null,
    });
  }

  console.log(JSON.stringify({ execute, count: plan.length, plan }, null, 2));
  if (!execute) {
    console.log("\nDry-run only. Re-run with --execute to apply.");
    return;
  }

  const now = new Date();
  const results = [];
  for (const step of plan) {
    if (step.action === "SKIP_LIVE_MODE" || step.action === "SKIP_LIVE_PT") {
      results.push(step);
      continue;
    }
    if (step.action === "ALREADY_HIDDEN") {
      results.push(step);
      continue;
    }
    if (step.action === "HIDE_FUNDED") {
      await prisma.paymentTicket.update({
        where: { id: step.ticketId },
        data: { hiddenFromChatAt: now },
      });
      results.push({ ...step, applied: true });
      continue;
    }
    if (step.action === "HIDE_UNFUNDED_TERMINAL") {
      await prisma.paymentTicket.update({
        where: { id: step.ticketId },
        data: { hiddenFromChatAt: now },
      });
      results.push({ ...step, applied: true });
      continue;
    }
    if (step.action === "EXPIRE_UNFUNDED") {
      const ticket = tickets.find((t) => t.id === step.ticketId);
      const pt = ticket?.protectedTransactionId
        ? ptById[ticket.protectedTransactionId]
        : null;
      if (pt?.stripePaymentIntentId && stripe) {
        try {
          const pi = await stripe.paymentIntents.retrieve(pt.stripePaymentIntentId);
          if (PI_CANCELABLE.includes(pi.status)) {
            await stripe.paymentIntents.cancel(pt.stripePaymentIntentId);
            results.push({ ticketId: step.ticketId, piCanceled: pi.id, piStatus: pi.status });
          } else if (pi.status === "succeeded" || pi.status === "processing") {
            results.push({
              ticketId: step.ticketId,
              skippedPi: pi.status,
              note: "PI succeeded/processing — hide only, no cancel",
            });
            await prisma.paymentTicket.update({
              where: { id: step.ticketId },
              data: { hiddenFromChatAt: now },
            });
            continue;
          }
        } catch (err) {
          results.push({
            ticketId: step.ticketId,
            piError: err instanceof Error ? err.message : String(err),
          });
        }
      }
      await prisma.$transaction(async (tx) => {
        if (pt && !pt.fundedAt) {
          const unfundedOk = [
            "ACCEPTED",
            "AWAITING_PAYMENT",
            "DRAFT",
            "AWAITING_ACCEPTANCE",
            "CANCELLED",
          ].includes(pt.status);
          if (unfundedOk && pt.status !== "CANCELLED") {
            await tx.protectedTransaction.update({
              where: { id: pt.id },
              data: { status: "CANCELLED", cancelledAt: now },
            });
          }
        }
        await tx.paymentTicket.update({
          where: { id: step.ticketId },
          data: { status: "EXPIRED", hiddenFromChatAt: now },
        });
      });
      results.push({ ...step, applied: true });
    }
  }

  console.log("\n=== APPLIED ===");
  console.log(JSON.stringify(results, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
