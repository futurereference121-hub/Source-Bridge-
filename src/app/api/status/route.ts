import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import {
  assertDailyLimit,
  checkDailyLimit,
  recordDailyAction,
} from "@/lib/rate-limit";
import { STATUS_MIN_INTERVAL_MS, STATUS_TTL_MS } from "@/lib/limits";
import { jsonError, statusSchema } from "@/lib/validation";
import { isStatusActive } from "@/lib/member-status";
import { notifyFollowersOfPost } from "@/lib/notifications";
import { z } from "zod";

function statusLimitPayload(
  limit: Awaited<ReturnType<typeof checkDailyLimit>>,
  opts: {
    serverNow: Date;
    nextAllowedAt: string | null;
    cooldownRemainingMs: number;
  },
) {
  return {
    ...limit,
    serverNow: opts.serverNow.toISOString(),
    nextAllowedAt: opts.nextAllowedAt,
    cooldownRemainingMs: opts.cooldownRemainingMs,
    minIntervalMs: STATUS_MIN_INTERVAL_MS,
  };
}

async function cooldownState(userId: string, now: Date) {
  const lastSuccess = await prisma.statusUpdate.findFirst({
    where: { userId },
    orderBy: { postedAt: "desc" },
    select: { postedAt: true, id: true, text: true, expiresAt: true },
  });
  if (!lastSuccess) {
    return {
      lastSuccess: null as null | typeof lastSuccess,
      nextAllowedAt: null as string | null,
      cooldownRemainingMs: 0,
      allowed: true,
    };
  }
  const elapsed = now.getTime() - lastSuccess.postedAt.getTime();
  const remaining = Math.max(0, STATUS_MIN_INTERVAL_MS - elapsed);
  return {
    lastSuccess,
    nextAllowedAt:
      remaining > 0
        ? new Date(lastSuccess.postedAt.getTime() + STATUS_MIN_INTERVAL_MS).toISOString()
        : null,
    cooldownRemainingMs: remaining,
    allowed: remaining <= 0,
  };
}

export async function GET() {
  try {
    const user = await requireSessionUser();
    const now = new Date();
    const latest = await prisma.statusUpdate.findFirst({
      where: { userId: user.id },
      orderBy: { postedAt: "desc" },
    });
    const status = latest
      ? {
          id: latest.id,
          text: latest.text,
          postedAt: latest.postedAt.toISOString(),
          expiresAt: latest.expiresAt.toISOString(),
        }
      : null;
    const limit = await checkDailyLimit(user.id, "status");
    const cool = await cooldownState(user.id, now);
    return Response.json({
      status: isStatusActive(status) ? status : null,
      limit: statusLimitPayload(limit, {
        serverNow: now,
        nextAllowedAt: cool.nextAllowedAt,
        cooldownRemainingMs: cool.cooldownRemainingMs,
      }),
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    return jsonError("Failed to load status", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (!user.emailVerified) return jsonError("Verify email first", 403);
    if (!user.onboardingComplete) {
      return jsonError("Complete your profile before publishing a status", 400);
    }

    const body = await req.json();
    const parsed = statusSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid status", 400);
    }

    const idempotencyKey =
      typeof body?.idempotencyKey === "string"
        ? body.idempotencyKey.trim().slice(0, 120)
        : "";

    const now = new Date();
    const cool = await cooldownState(user.id, now);
    if (!cool.allowed) {
      const limit = await checkDailyLimit(user.id, "status");
      return jsonError(
        `Wait at least 1 hour between Status updates. Try again after ${cool.nextAllowedAt}.`,
        429,
        {
          code: "STATUS_COOLDOWN",
          limit: statusLimitPayload(limit, {
            serverNow: now,
            nextAllowedAt: cool.nextAllowedAt,
            cooldownRemainingMs: cool.cooldownRemainingMs,
          }),
        },
      );
    }

    await assertDailyLimit(user.id, "status");
    const expiresAt = new Date(now.getTime() + STATUS_TTL_MS);

    // Idempotency BEFORE expire — never burn a daily slot on a retry.
    if (idempotencyKey) {
      const recent = await prisma.statusUpdate.findFirst({
        where: {
          userId: user.id,
          text: parsed.data.text,
          postedAt: { gte: new Date(now.getTime() - 60_000) },
        },
        orderBy: { postedAt: "desc" },
      });
      if (recent) {
        const limit = await checkDailyLimit(user.id, "status");
        const coolAfter = await cooldownState(user.id, now);
        return Response.json({
          ok: true,
          existing: true,
          status: {
            id: recent.id,
            text: recent.text,
            postedAt: recent.postedAt.toISOString(),
            expiresAt: recent.expiresAt.toISOString(),
          },
          limit: statusLimitPayload(limit, {
            serverNow: now,
            nextAllowedAt: coolAfter.nextAllowedAt,
            cooldownRemainingMs: coolAfter.cooldownRemainingMs,
          }),
        });
      }
    }

    const row = await prisma.$transaction(async (tx) => {
      await tx.statusUpdate.updateMany({
        where: {
          userId: user.id,
          expiresAt: { gt: now },
        },
        data: { expiresAt: now },
      });

      return tx.statusUpdate.create({
        data: {
          userId: user.id,
          text: parsed.data.text,
          postedAt: now,
          expiresAt,
        },
      });
    });

    const limit = await recordDailyAction(user.id, "status", now);
    const coolAfter = await cooldownState(user.id, now);

    if (user.slug) {
      await notifyFollowersOfPost({
        authorId: user.id,
        authorName: user.username ? `@${user.username}` : user.name,
        kind: "STATUS",
        text: row.text,
        href: `/members/${user.slug}`,
      });
    }

    return Response.json({
      ok: true,
      status: {
        id: row.id,
        text: row.text,
        postedAt: row.postedAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      },
      limit: statusLimitPayload(limit, {
        serverNow: now,
        nextAllowedAt: coolAfter.nextAllowedAt,
        cooldownRemainingMs: coolAfter.cooldownRemainingMs,
      }),
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    if (status === 429) {
      return jsonError(err instanceof Error ? err.message : "Daily limit", 429);
    }
    console.error("[status:post]", err);
    return jsonError("Failed to publish status", 500);
  }
}

const patchSchema = z.object({
  text: z.string().trim().min(1).max(500),
});

/** Edit the current active status in place. */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid status", 400);
    }
    const now = new Date();
    const current = await prisma.statusUpdate.findFirst({
      where: { userId: user.id, expiresAt: { gt: now } },
      orderBy: { postedAt: "desc" },
    });
    if (!current) return jsonError("No active status to edit", 404);
    const updated = await prisma.statusUpdate.update({
      where: { id: current.id },
      data: { text: parsed.data.text },
    });
    return Response.json({
      ok: true,
      status: {
        id: updated.id,
        text: updated.text,
        postedAt: updated.postedAt.toISOString(),
        expiresAt: updated.expiresAt.toISOString(),
      },
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    return jsonError("Failed to edit status", 500);
  }
}

/** Delete/expire the current active status — does not consume a daily slot. */
export async function DELETE() {
  try {
    const user = await requireSessionUser();
    const now = new Date();
    await prisma.statusUpdate.updateMany({
      where: { userId: user.id, expiresAt: { gt: now } },
      data: { expiresAt: now },
    });
    const limit = await checkDailyLimit(user.id, "status");
    const cool = await cooldownState(user.id, now);
    return Response.json({
      ok: true,
      limit: statusLimitPayload(limit, {
        serverNow: now,
        nextAllowedAt: cool.nextAllowedAt,
        cooldownRemainingMs: cool.cooldownRemainingMs,
      }),
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    return jsonError("Failed to delete status", 500);
  }
}
