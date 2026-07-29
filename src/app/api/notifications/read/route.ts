import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { jsonError, notificationReadSchema } from "@/lib/validation";

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body = await req.json().catch(() => ({}));
    const parsed = notificationReadSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid request", 400);
    }

    const now = new Date();
    if (parsed.data.all) {
      await prisma.notification.updateMany({
        where: { userId: user.id, readAt: null },
        data: { readAt: now },
      });
    } else {
      await prisma.notification.updateMany({
        where: { userId: user.id, id: { in: parsed.data.ids }, readAt: null },
        data: { readAt: now },
      });
    }

    const unreadCount = await prisma.notification.count({
      where: { userId: user.id, readAt: null },
    });

    return Response.json({ ok: true, unreadCount });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[notifications:read]", err);
    return jsonError("Failed to update notifications", status);
  }
}
