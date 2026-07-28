import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/validation";

export async function GET(req: Request) {
  try {
    await requireAdmin();
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const page = Math.max(Number(url.searchParams.get("page") || 1), 1);
    const take = Math.min(Math.max(Number(url.searchParams.get("limit") || 30), 1), 100);
    const where = status ? { status } : { status: "PENDING" };
    const [requests, total] = await prisma.$transaction([
      prisma.identityVerificationRequest.findMany({
        where,
        orderBy: { submittedAt: "asc" },
        skip: (page - 1) * take,
        take,
        include: {
          user: { select: { id: true, email: true, name: true, username: true } },
          documents: { where: { deletedAt: null }, select: { id: true, kind: true, mimeType: true, sizeBytes: true, createdAt: true } },
        },
      }),
      prisma.identityVerificationRequest.count({ where }),
    ]);
    return Response.json({ requests, total, page, limit: take });
  } catch (error) {
    const status = (error as { status?: number }).status || 500;
    return jsonError(status === 401 ? "Sign in required" : status === 403 ? "Admin only" : "Could not load verification queue", status);
  }
}
