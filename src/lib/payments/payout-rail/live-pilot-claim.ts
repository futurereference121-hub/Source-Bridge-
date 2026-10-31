/**
 * Durable named-LIVE-pilot bind. Pure matching stays in live-pilot.ts.
 * The first dual-accepted LIVE Global Payouts transaction claims the slot.
 * Money paths read that claim when GLOBAL_PAYOUTS_LIVE_PILOT_TRANSACTION_ID is empty,
 * so checkout does not wait for a mid-flow env edit.
 */

import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import {
  evaluateLivePilotTransactionClaim,
  LIVE_GP_PILOT_BOUND_ACTION,
  LIVE_PILOT_LOCK_KEY,
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
