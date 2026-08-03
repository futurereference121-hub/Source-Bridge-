import { prisma } from "@/lib/db";
import { getStripeMode, type StripeMode } from "@/lib/payments/flags";

export type AppendLedgerInput = {
  protectedTxnId: string;
  entryType:
    | "CHARGE"
    | "PROCUREMENT_TRANSFER"
    | "FINAL_TRANSFER"
    | "REFUND"
    | "FEE"
    | "ADJUSTMENT"
    | "DISPUTE_HOLD";
  direction: "CREDIT" | "DEBIT";
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
  stripeObjectId?: string;
  stripeObjectType?: string;
  stripeMode?: StripeMode;
  meta?: Record<string, unknown>;
};

/**
 * Append-only ledger. Duplicate idempotency keys return the existing row
 * without mutating amounts.
 */
export async function appendLedgerEntry(input: AppendLedgerInput) {
  const existing = await prisma.ledgerEntry.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) return { entry: existing, created: false };

  const entry = await prisma.ledgerEntry.create({
    data: {
      protectedTxnId: input.protectedTxnId,
      entryType: input.entryType,
      direction: input.direction,
      amountMinor: input.amountMinor,
      currency: input.currency.toUpperCase(),
      stripeMode: input.stripeMode || getStripeMode(),
      stripeObjectId: input.stripeObjectId || "",
      stripeObjectType: input.stripeObjectType || "",
      idempotencyKey: input.idempotencyKey,
      metaJson: JSON.stringify(input.meta || {}),
    },
  });
  return { entry, created: true };
}

export async function recordAuditEvent(opts: {
  protectedTxnId?: string | null;
  actorUserId?: string | null;
  action: string;
  reason?: string;
  meta?: Record<string, unknown>;
}) {
  return prisma.financialAuditEvent.create({
    data: {
      protectedTxnId: opts.protectedTxnId || null,
      actorUserId: opts.actorUserId || null,
      action: opts.action,
      reason: opts.reason || "",
      metaJson: JSON.stringify(opts.meta || {}),
    },
  });
}
