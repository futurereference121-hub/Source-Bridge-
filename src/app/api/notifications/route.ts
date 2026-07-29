import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { jsonError } from "@/lib/validation";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function mapNotification(n: {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string;
  actorId: string | null;
  actorName: string;
  readAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    href: n.href,
    actorId: n.actorId,
    actorName: n.actorName,
    read: Boolean(n.readAt),
    createdAt: n.createdAt.toISOString(),
  };
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const sp = req.nextUrl.searchParams;
    const cursor = sp.get("cursor") || undefined;
    const limit = Math.min(
      Math.max(Number(sp.get("limit") || DEFAULT_LIMIT) || DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );

    const [rows, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: limit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      }),
      prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);

    const slice = rows.slice(0, limit);

    return Response.json({
      items: slice.map(mapNotification),
      nextCursor: rows.length > limit ? (slice[slice.length - 1]?.id ?? null) : null,
      unreadCount,
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[notifications:list]", err);
    return jsonError("Failed to load notifications", 500);
  }
}
