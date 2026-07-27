import { prisma } from "@/lib/db";
import {
  calendarDayKey,
  DAILY_MESSAGE_LIMIT,
  DAILY_OPPORTUNITY_LIMIT,
  DAILY_SOURCING_LIMIT,
  DAILY_STATUS_LIMIT,
} from "@/lib/limits";

export type RateLimitAction = "status" | "opportunity" | "message" | "sourcing";

const LIMITS: Record<RateLimitAction, number> = {
  status: DAILY_STATUS_LIMIT,
  opportunity: DAILY_OPPORTUNITY_LIMIT,
  message: DAILY_MESSAGE_LIMIT,
  sourcing: DAILY_SOURCING_LIMIT,
};

export type RateLimitCheck = {
  allowed: boolean;
  used: number;
  limit: number;
  dayKey: string;
  remaining: number;
};

export async function checkDailyLimit(
  userId: string,
  action: RateLimitAction,
  now: Date = new Date(),
): Promise<RateLimitCheck> {
  const dayKey = calendarDayKey(now);
  const limit = LIMITS[action];
  const used = await prisma.rateLimitEvent.count({
    where: { userId, action, dayKey },
  });
  return {
    allowed: used < limit,
    used,
    limit,
    dayKey,
    remaining: Math.max(0, limit - used),
  };
}

/** Record a successful action toward the daily limit. Call AFTER create succeeds. */
export async function recordDailyAction(
  userId: string,
  action: RateLimitAction,
  now: Date = new Date(),
): Promise<RateLimitCheck> {
  const dayKey = calendarDayKey(now);
  await prisma.rateLimitEvent.create({
    data: { userId, action, dayKey },
  });
  return checkDailyLimit(userId, action, now);
}

export async function assertDailyLimit(
  userId: string,
  action: RateLimitAction,
): Promise<RateLimitCheck> {
  const check = await checkDailyLimit(userId, action);
  if (!check.allowed) {
    const err = new Error(
      `Daily limit reached (${check.limit}/${check.limit} ${action} updates today). Try again tomorrow.`,
    );
    (err as Error & { status: number; code: string }).status = 429;
    (err as Error & { code: string }).code = "RATE_LIMIT";
    throw err;
  }
  return check;
}
