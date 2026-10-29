/**
 * Durable per-mode, per-currency lock. The row survives a crash.
 * A fresh lock makes other workers wait. A stale lock is stolen, then
 * open attempts are reconciled before any new payout.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/db";
import {
  isGlobalPayoutsProceedsFundingEnabled,
  isPlatformBankRemainderPayoutEnabled,
} from "@/lib/payments/flags";
import {
  lockAcquisition,
  lockCompletionWrite,
  PLATFORM_BALANCE_LOCK_STALE_MS,
  resumeWorkerAfterTakeover,
  type LockOwner,
} from "@/lib/payments/payout-rail/platform-balance";

type HeldLock = LockOwner & { mode: string; currency: string };

const ownerStore = new AsyncLocalStorage<HeldLock>();

function spendNeedsCoordination(mode: "TEST" | "LIVE"): boolean {
  if (isPlatformBankRemainderPayoutEnabled(mode)) return true;
  return isGlobalPayoutsProceedsFundingEnabled();
}

export function isCoordinationRetryable(err: unknown): boolean {
  const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
  return code === "COORDINATION_BUSY" || code === "LOCK_FENCE_LOST";
}

async function readLockOwner(mode: string, currency: string): Promise<LockOwner | null> {
  const row = await prisma.platformBalanceCoordination.findUnique({
    where: { stripeMode_currency: { stripeMode: mode, currency } },
    select: { lockToken: true, fence: true },
  });
  if (!row?.lockToken || row.fence <= 0) return null;
  return { token: row.lockToken, fence: row.fence };
}

/** Re-read the lock and run the Stripe write only if this worker still owns it. */
export async function fencedProviderWrite<T>(write: () => Promise<T>): Promise<T> {
  const held = ownerStore.getStore() ?? null;
  const current = held ? await readLockOwner(held.mode, held.currency) : null;
  const result = await resumeWorkerAfterTakeover({
    held: held ?? { token: "", fence: 0 },
    readCurrent: async () => current,
    write,
  });
  if (!result.submitted) {
    throw Object.assign(new Error("Platform balance lock was taken over"), { code: "LOCK_FENCE_LOST" });
  }
  return result.value;
}

/**
 * Connect transfers and refunds keep their amounts and destinations.
 * While remainder funding or bank payouts are enabled, they take the same lock
 * and refuse the provider write if that lock has been stolen. With those flags
 * off, the existing call runs immediately and does not touch the coordination table.
 */
export async function coordinatePlatformSpend<T>(
  mode: string,
  currency: string,
  write: () => Promise<T>,
): Promise<T> {
  const stripeMode = mode === "LIVE" ? "LIVE" : "TEST";
  const normalized = currency.trim().toUpperCase();
  if (!spendNeedsCoordination(stripeMode)) return write();
  const existing = ownerStore.getStore();
  if (existing && existing.mode === stripeMode && existing.currency === normalized) {
    return fencedProviderWrite(write);
  }
  const locked = await withPlatformBalanceLock(stripeMode, normalized, new Date(), async () =>
    fencedProviderWrite(write),
  );
  if (!locked.acquired) {
    throw Object.assign(new Error("Platform balance lock is busy"), { code: "COORDINATION_BUSY" });
  }
  return locked.value;
}

export type PlatformBalanceLockReport = {
  code: string;
  hadPriorSuccess: boolean;
  token: string;
  fence: number;
  recordAs: "money" | "warmup";
};

export async function withPlatformBalanceLock<T>(
  mode: string,
  currency: string,
  now: Date,
  fn: (report: PlatformBalanceLockReport) => Promise<T>,
  opts?: { recordAs?: "money" | "warmup" },
): Promise<{ acquired: true; value: T } | { acquired: false; code: string }> {
  const stripeMode = mode === "LIVE" ? "LIVE" : "TEST";
  const normalizedCurrency = currency.trim().toUpperCase();
  const recordAs = opts?.recordAs === "warmup" ? "warmup" : "money";
  const held = await prisma.$transaction(async (tx) => {
    await tx.platformBalanceCoordination.upsert({
      where: { stripeMode_currency: { stripeMode, currency: normalizedCurrency } },
      create: { stripeMode, currency: normalizedCurrency },
      update: {},
    });
    const rows = await tx.$queryRaw<Array<{ id: string; lockedAt: Date | null; lastSuccessAt: Date | null }>>`
      SELECT "id", "lockedAt", "lastSuccessAt"
      FROM "PlatformBalanceCoordination"
      WHERE "stripeMode" = ${stripeMode} AND "currency" = ${normalizedCurrency}
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) return { acquired: false as const, code: "COORDINATION_MISSING" };
    const decision = lockAcquisition({
      nowMs: now.getTime(),
      lockedAtMs: row.lockedAt ? row.lockedAt.getTime() : null,
      staleMs: PLATFORM_BALANCE_LOCK_STALE_MS,
    });
    if (decision === "busy") return { acquired: false as const, code: "COORDINATION_BUSY" };
    const token = randomUUID();
    const updated = await tx.platformBalanceCoordination.update({
      where: { id: row.id },
      data: {
        lockToken: token,
        lockedAt: now,
        fence: { increment: 1 },
        ...(recordAs === "money" ? { lastStartedAt: now } : {}),
      },
      select: { fence: true },
    });
    return {
      acquired: true as const,
      id: row.id,
      token,
      fence: updated.fence,
      hadPriorSuccess: row.lastSuccessAt != null,
    };
  });
  if (!held.acquired) return held;

  const report: PlatformBalanceLockReport = {
    code: "",
    hadPriorSuccess: held.hadPriorSuccess,
    token: held.token,
    fence: held.fence,
    recordAs,
  };
  const heldLock: HeldLock = {
    token: held.token,
    fence: held.fence,
    mode: stripeMode,
    currency: normalizedCurrency,
  };
  let succeeded = false;
  try {
    const value = await ownerStore.run(heldLock, () => fn(report));
    succeeded = true;
    return { acquired: true, value };
  } catch (err) {
    report.code = report.code || "PLATFORM_BALANCE_FAILED";
    throw err;
  } finally {
    await prisma.platformBalanceCoordination.updateMany({
      where: { id: held.id, lockToken: held.token },
      data: lockCompletionWrite({
        succeeded,
        recordAs: report.recordAs,
        code: report.code,
      }),
    });
  }
}
