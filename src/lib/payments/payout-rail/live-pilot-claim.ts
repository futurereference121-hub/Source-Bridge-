/**
 * Durable named-LIVE-pilot bind. Pure matching stays in live-pilot.ts.
 * The first dual-accepted LIVE Global Payouts transaction claims the slot.
 * Money paths read that claim when GLOBAL_PAYOUTS_LIVE_PILOT_TRANSACTION_ID is empty,
 * so checkout does not wait for a mid-flow env edit.
 */

import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { liveCollectionOnlyControlEnv } from "@/lib/payments/flags";
import {
  evaluateLiveCollectionOnlyCharge,
  evaluateLivePilotTransactionClaim,
  LIVE_COLLECTION_LOCK_KEY,
  LIVE_GP_COLLECTION_ONLY_ACTION,
  LIVE_GP_PILOT_BOUND_ACTION,
  LIVE_PILOT_LOCK_KEY,
  matchLiveCollectionOnlyPair,
  parsePilotTransactionId,
  resolveAuthorizedPilotTransactionId,
} from "@/lib/payments/payout-rail/live-pilot";

type Db = Prisma.TransactionClient | typeof prisma;

export async function readClaimedLivePilotTransactionId(
  db: Db = prisma,
): Promise<string | null> {
  const row = await db.financialAuditEvent.findFirst({
    where: { action: LIVE_GP_PILOT_BOUND_ACTION },
    orderBy: { createdAt: "asc" },
    select: { protectedTxnId: true },
  });
  return parsePilotTransactionId(row?.protectedTxnId || "") || null;
}

export async function resolveLivePilotAuthorizedTransactionId(
  db: Db = prisma,
): Promise<string | null> {
  return resolveAuthorizedPilotTransactionId({
    envRaw: process.env.GLOBAL_PAYOUTS_LIVE_PILOT_TRANSACTION_ID || "",
    claimedTransactionId: await readClaimedLivePilotTransactionId(db),
  });
}

export async function livePilotControlEnv(db: Db = prisma): Promise<{
  userAllowlistRaw: string;
  configuredSourceCurrencyRaw: string;
  amountCapRaw: string;
  authorizedTransactionIdRaw: string;
  destinationMinimumsRaw: string;
}> {
  const authorized = await resolveLivePilotAuthorizedTransactionId(db);
  return {
    userAllowlistRaw: process.env.GLOBAL_PAYOUTS_USER_ALLOWLIST || "",
    configuredSourceCurrencyRaw: process.env.GLOBAL_PAYOUTS_LIVE_PILOT_SOURCE_CURRENCY || "",
    amountCapRaw: process.env.GLOBAL_PAYOUTS_LIVE_PILOT_AMOUNT_CAP_MINOR || "",
    authorizedTransactionIdRaw: authorized || "",
    destinationMinimumsRaw: process.env.GLOBAL_PAYOUTS_LIVE_DESTINATION_MINIMUMS || "",
  };
}

export async function readClaimedLiveCollectionOnlyTransactionId(
  db: Db = prisma,
): Promise<string | null> {
  const row = await db.financialAuditEvent.findFirst({
    where: { action: LIVE_GP_COLLECTION_ONLY_ACTION },
    orderBy: { createdAt: "asc" },
    select: { protectedTxnId: true },
  });
  return parsePilotTransactionId(row?.protectedTxnId || "") || null;
}

export async function liveCollectionOnlyTransactionIds(
  db: Db = prisma,
): Promise<string[]> {
  const rows = await db.financialAuditEvent.findMany({
    where: { action: LIVE_GP_COLLECTION_ONLY_ACTION },
    select: { protectedTxnId: true },
  });
  const ids: string[] = [];
  for (const row of rows) {
    const id = parsePilotTransactionId(row.protectedTxnId || "");
    if (id) ids.push(id);
  }
  return ids;
}

export async function isLiveCollectionOnlyTransaction(
  txnId: string,
  db: Db = prisma,
): Promise<boolean> {
  const id = parsePilotTransactionId(txnId);
  if (!id) return false;
  const row = await db.financialAuditEvent.findFirst({
    where: { action: LIVE_GP_COLLECTION_ONLY_ACTION, protectedTxnId: id },
    select: { id: true },
  });
  return Boolean(row);
}

export async function assertLiveCollectionOnlyBlocksPayout(
  txnId: string,
  db: Db = prisma,
): Promise<void> {
  if (await isLiveCollectionOnlyTransaction(txnId, db)) {
    throw Object.assign(
      new Error("This payment is collection-only and cannot be paid out."),
      { status: 409, code: "GP_COLLECTION_ONLY" },
    );
  }
}

export async function assertLiveCollectionOnlyOccupancy(opts: {
  buyerId: string;
  sellerId: string;
  excludeTicketId?: string | null;
}): Promise<void> {
  const claimed = await readClaimedLiveCollectionOnlyTransactionId();
  if (claimed) {
    throw Object.assign(
      new Error("This collection-only payment is already in use."),
      { status: 409, code: "GP_COLLECTION_ONLY_OCCUPIED" },
    );
  }
  const other = await prisma.paymentTicket.findFirst({
    where: {
      buyerId: opts.buyerId,
      sellerId: opts.sellerId,
      stripeMode: "LIVE",
      payoutRail: "STRIPE_GLOBAL_PAYOUTS",
      status: { in: ["DRAFT", "PROPOSED", "ACCEPTED", "FUNDED"] },
      ...(opts.excludeTicketId ? { id: { not: opts.excludeTicketId } } : {}),
    },
    select: { id: true },
  });
  if (other) {
    throw Object.assign(
      new Error("This collection-only payment is already in use."),
      { status: 409, code: "GP_COLLECTION_ONLY_OCCUPIED" },
    );
  }
}

export async function bindLiveCollectionOnlyIfOpen(
  tx: Prisma.TransactionClient,
  opts: {
    transactionId: string;
    ticketId: string;
    actorUserId: string;
    buyerId: string;
    sellerId: string;
    stripeMode: string;
    payoutRail: string;
    currency: string;
    totalChargeMinor: number;
  },
): Promise<boolean> {
  if (String(opts.stripeMode || "").toUpperCase() !== "LIVE") return false;
  if (String(opts.payoutRail || "").trim().toUpperCase() !== "STRIPE_GLOBAL_PAYOUTS") {
    return false;
  }
  const users = await tx.user.findMany({
    where: { id: { in: [opts.buyerId, opts.sellerId] } },
    select: { id: true, email: true },
  });
  const buyer = users.find((row) => row.id === opts.buyerId);
  const seller = users.find((row) => row.id === opts.sellerId);
  if (!buyer || !seller) return false;
  const matched = matchLiveCollectionOnlyPair({
    ...liveCollectionOnlyControlEnv(),
    buyerId: opts.buyerId,
    sellerId: opts.sellerId,
    buyerEmail: buyer.email,
    sellerEmail: seller.email,
  });
  if (!matched.ok) return false;
  const charge = evaluateLiveCollectionOnlyCharge({
    pairMatched: true,
    currency: opts.currency,
    configuredCurrency: matched.currency,
    totalChargeMinor: opts.totalChargeMinor,
    capMinor: matched.capMinor,
  });
  if (!charge.ok) {
    throw Object.assign(new Error("This collection-only payment is outside the approved charge."), {
      status: 409,
      code: charge.code,
    });
  }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BigInt(LIVE_COLLECTION_LOCK_KEY)})`;
  const existingId = await readClaimedLiveCollectionOnlyTransactionId(tx);
  if (existingId && existingId !== opts.transactionId) {
    throw Object.assign(
      new Error("This collection-only payment is already in use."),
      { status: 409, code: "GP_COLLECTION_ONLY_OCCUPIED" },
    );
  }
  if (existingId === opts.transactionId) return true;
  await tx.financialAuditEvent.create({
    data: {
      protectedTxnId: opts.transactionId,
      actorUserId: opts.actorUserId,
      action: LIVE_GP_COLLECTION_ONLY_ACTION,
      reason: "Named LIVE collection-only ticket. Held funds. No seller payout.",
      metaJson: JSON.stringify({ ticketId: opts.ticketId }),
    },
  });
  return true;
}

export async function bindLivePilotTransactionIfOpen(
  tx: Prisma.TransactionClient,
  opts: {
    transactionId: string;
    ticketId: string;
    actorUserId: string;
    stripeMode: string;
    payoutRail: string;
  },
): Promise<void> {
  if (String(opts.stripeMode || "").toUpperCase() !== "LIVE") return;
  if (String(opts.payoutRail || "").trim().toUpperCase() !== "STRIPE_GLOBAL_PAYOUTS") {
    return;
  }
  if (await isLiveCollectionOnlyTransaction(opts.transactionId, tx)) return;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BigInt(LIVE_PILOT_LOCK_KEY)})`;
  const existingId = await readClaimedLivePilotTransactionId(tx);
  const decision = evaluateLivePilotTransactionClaim({
    existingClaimedId: existingId,
    candidateTransactionId: opts.transactionId,
  });
  if (!decision.ok || decision.alreadyClaimed) return;
  await tx.financialAuditEvent.create({
    data: {
      protectedTxnId: opts.transactionId,
      actorUserId: opts.actorUserId,
      action: LIVE_GP_PILOT_BOUND_ACTION,
      reason: "Named LIVE Global Payouts pilot transaction",
      metaJson: JSON.stringify({ ticketId: opts.ticketId }),
    },
  });
}
