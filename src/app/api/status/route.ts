import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { assertDailyLimit, checkDailyLimit, recordDailyAction } from "@/lib/rate-limit";
import { STATUS_TTL_MS } from "@/lib/limits";
import { jsonError, statusSchema } from "@/lib/validation";
import { isStatusActive } from "@/lib/member-status";

export async function GET() {
  try {
    const user = await requireSessionUser();
    const latest = await prisma.statusUpdate.findFirst({
      where: { userId: user.id },
      orderBy: { postedAt: "desc" },
    });
    const status = latest
      ? {
          text: latest.text,
          postedAt: latest.postedAt.toISOString(),
          expiresAt: latest.expiresAt.toISOString(),
        }
      : null;
    const limit = await checkDailyLimit(user.id, "status");
    return Response.json({
      status: isStatusActive(status) ? status : null,
      limit,
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
      return jsonError("Complete your profile before publishing a status", 403);
    }

    const body = await req.json();
    const parsed = statusSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid status", 400);
    }

    await assertDailyLimit(user.id, "status");
    const now = new Date();
    const row = await prisma.statusUpdate.create({
      data: {
        userId: user.id,
        text: parsed.data.text,
        postedAt: now,
        expiresAt: new Date(now.getTime() + STATUS_TTL_MS),
      },
    });
    const limit = await recordDailyAction(user.id, "status", now);

    return Response.json({
      ok: true,
      status: {
        text: row.text,
        postedAt: row.postedAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      },
      limit,
    });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : "Failed to publish status";
    if (status === 401) return jsonError("Sign in required", 401);
    if (status === 429) return jsonError(message, 429);
    console.error("[status]", err);
    return jsonError(message, status);
  }
}
