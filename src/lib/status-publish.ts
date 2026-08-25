/**
 * Atomic Status publication write path.
 *
 * Rate-limit model (do not conflate):
 * - Daily 3/day: RateLimitEvent rows for action "status" on calendar day (APP_TIMEZONE / UTC)
 * - 1h cooldown: last SUCCESSFUL StatusUpdate.postedAt (history, including expired/deleted)
 * - Active display: newest StatusUpdate with expiresAt > now (ONE at a time; replace supersedes)
 *
 * Failed / duplicate / idempotent retries do NOT burn daily quota or advance cooldown.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  calendarDayKey,
  DAILY_STATUS_LIMIT,
  STATUS_MIN_INTERVAL_MS,
  STATUS_TTL_MS,
} from "./limits";

type Db = PrismaClient | Prisma.TransactionClient;

export type StatusCanonical = {
  id: string;
  text: string;
  postedAt: string;
  expiresAt: string;
  /** Monotonic publish sequence for stale-response protection (ms of postedAt). */
  version: number;
};

export type StatusLimitPayload = {
  allowed: boolean;
  used: number;
  limit: number;
  dayKey: string;
  remaining: number;
  serverNow: string;
  nextAllowedAt: string | null;
  cooldownRemainingMs: number;
  minIntervalMs: number;
};

export type PublishStatusOk = {
  ok: true;
  existing?: boolean;
  status: StatusCanonical;
  limit: StatusLimitPayload;
};

export type PublishStatusErr = {
  ok: false;
  code: "STATUS_COOLDOWN" | "STATUS_DAILY_LIMIT";
  message: string;
  limit: StatusLimitPayload;
};

export type PublishStatusResult = PublishStatusOk | PublishStatusErr;

function toCanonical(row: {
  id: string;
  text: string;
  postedAt: Date;
  expiresAt: Date;
}): StatusCanonical {
  return {
    id: row.id,
    text: row.text,
    postedAt: row.postedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    version: row.postedAt.getTime(),
  };
}

async function dailyUsed(db: Db, userId: string, dayKey: string): Promise<number> {
  return db.rateLimitEvent.count({
    where: { userId, action: "status", dayKey },
  });
}

function limitPayload(
  used: number,
  now: Date,
  cool: { nextAllowedAt: string | null; cooldownRemainingMs: number },
): StatusLimitPayload {
  return {
    allowed: used < DAILY_STATUS_LIMIT,
    used,
    limit: DAILY_STATUS_LIMIT,
    dayKey: calendarDayKey(now),
    remaining: Math.max(0, DAILY_STATUS_LIMIT - used),
    serverNow: now.toISOString(),
    nextAllowedAt: cool.nextAllowedAt,
    cooldownRemainingMs: cool.cooldownRemainingMs,
    minIntervalMs: STATUS_MIN_INTERVAL_MS,
  };
}

function cooldownFromLast(lastPostedAt: Date | null, now: Date) {
  if (!lastPostedAt) {
    return { nextAllowedAt: null as string | null, cooldownRemainingMs: 0, allowed: true };
  }
  const elapsed = now.getTime() - lastPostedAt.getTime();
  const remaining = Math.max(0, STATUS_MIN_INTERVAL_MS - elapsed);
  return {
    nextAllowedAt:
      remaining > 0
        ? new Date(lastPostedAt.getTime() + STATUS_MIN_INTERVAL_MS).toISOString()
        : null,
    cooldownRemainingMs: remaining,
    allowed: remaining <= 0,
  };
}

export async function readStatusPublishState(db: Db, userId: string, now: Date = new Date()) {
  const dayKey = calendarDayKey(now);
  const [lastSuccess, used, active] = await Promise.all([
    db.statusUpdate.findFirst({
      where: { userId },
      orderBy: { postedAt: "desc" },
      select: { id: true, text: true, postedAt: true, expiresAt: true },
    }),
    dailyUsed(db, userId, dayKey),
    db.statusUpdate.findFirst({
      where: { userId, expiresAt: { gt: now } },
      orderBy: { postedAt: "desc" },
      select: { id: true, text: true, postedAt: true, expiresAt: true },
    }),
  ]);
  const cool = cooldownFromLast(lastSuccess?.postedAt ?? null, now);
  return {
    dayKey,
    used,
    lastSuccess,
    active,
    cool,
    limit: limitPayload(used, now, cool),
  };
}

/**
 * Publish a new Status (or return idempotent existing).
 * Injectable `now` for clock-based tests (1h / next day / 24h expiry).
 */
export async function publishStatusAtomic(
  prisma: PrismaClient,
  opts: {
    userId: string;
    text: string;
    idempotencyKey?: string;
    now?: Date;
  },
): Promise<PublishStatusResult> {
  const now = opts.now ?? new Date();
  const text = opts.text.trim();
  const idempotencyKey = (opts.idempotencyKey || "").trim().slice(0, 120);

  return prisma.$transaction(
    async (tx) => {
      // Serialize publishes per user (prevents concurrent double-active).
      await tx.$executeRaw`SELECT id FROM "User" WHERE id = ${opts.userId} FOR UPDATE`;

      const state = await readStatusPublishState(tx, opts.userId, now);

      // Idempotency BEFORE cooldown/daily burn:
      // 1) same text within 60s of last success
      // 2) optional client key echoed in recent same-text window (key stored only client-side;
      //    server keys off same-text+window which covers double-click)
      if (state.lastSuccess && state.lastSuccess.text === text) {
        const age = now.getTime() - state.lastSuccess.postedAt.getTime();
        if (age >= 0 && age < 60_000) {
          return {
            ok: true as const,
            existing: true,
            status: toCanonical(state.lastSuccess),
            limit: state.limit,
          };
        }
      }

      // Also: if an active row already has this exact text (retry after soft errors),
      // return it without burning when within the same minute of its postedAt.
      if (state.active && state.active.text === text) {
        const age = now.getTime() - state.active.postedAt.getTime();
        if (age >= 0 && age < 60_000) {
          return {
            ok: true as const,
            existing: true,
            status: toCanonical(state.active),
            limit: state.limit,
          };
        }
      }

      void idempotencyKey; // reserved; same-text window is the durable server dedupe

      if (state.used >= DAILY_STATUS_LIMIT) {
        return {
          ok: false as const,
          code: "STATUS_DAILY_LIMIT" as const,
          message: "You've used your 3 Status updates for today.",
          limit: state.limit,
        };
      }

      if (!state.cool.allowed) {
        const mins = Math.max(1, Math.ceil(state.cool.cooldownRemainingMs / 60_000));
        return {
          ok: false as const,
          code: "STATUS_COOLDOWN" as const,
          message: `You can update your Status again in ${mins} minute${mins === 1 ? "" : "s"}.`,
          limit: state.limit,
        };
      }

      // Supersede any currently-active rows, then write the new active.
      await tx.statusUpdate.updateMany({
        where: { userId: opts.userId, expiresAt: { gt: now } },
        data: { expiresAt: now },
      });

      const expiresAt = new Date(now.getTime() + STATUS_TTL_MS);
      const row = await tx.statusUpdate.create({
        data: {
          userId: opts.userId,
          text,
          postedAt: now,
          expiresAt,
        },
      });

      // ONE publication event for this success (inside the same transaction).
      await tx.rateLimitEvent.create({
        data: {
          userId: opts.userId,
          action: "status",
          dayKey: state.dayKey,
        },
      });

      const usedAfter = state.used + 1;
      const coolAfter = cooldownFromLast(row.postedAt, now);
      return {
        ok: true as const,
        status: toCanonical(row),
        limit: limitPayload(usedAfter, now, coolAfter),
      };
    },
    {
      // Keep lock duration short; status writes are tiny.
      maxWait: 5_000,
      timeout: 10_000,
    },
  );
}

/** Expire active status only — does not consume daily slot or erase history. */
export async function deleteActiveStatus(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<{ limit: StatusLimitPayload }> {
  await prisma.statusUpdate.updateMany({
    where: { userId, expiresAt: { gt: now } },
    data: { expiresAt: now },
  });
  const state = await readStatusPublishState(prisma, userId, now);
  return { limit: state.limit };
}
