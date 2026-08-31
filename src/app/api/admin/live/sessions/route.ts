import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { toLiveSessionPublic } from "@/lib/live/sessions";
import { jsonError } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    const now = new Date();
    const rows = await prisma.liveSession.findMany({
      where: {
        OR: [
          { status: { in: ["PREPARING", "LIVE"] } },
          { status: "ENDED", wasLiveUntil: { gt: now } },
          { reports: { some: { status: "OPEN" } } },
        ],
      },
      include: {
        broadcaster: {
          select: {
            id: true,
            username: true,
            slug: true,
            name: true,
            photo: true,
          },
        },
        reports: {
          where: { status: "OPEN" },
          select: { id: true, reason: true, createdAt: true },
          take: 10,
        },
      },
      orderBy: [{ status: "asc" }, { startedAt: "desc" }],
      take: 80,
    });
    return Response.json({
      sessions: rows.map((row) => ({
        ...toLiveSessionPublic(row, now),
        openReports: row.reports.length,
      })),
    });
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    if (status === 401) return jsonError("Sign in required", 401);
    if (status === 403) return jsonError("Admin only", 403);
    console.error("[admin:live]", err);
    return jsonError("Could not load Live sessions", 500);
  }
}
