import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/validation";

export async function GET() {
  try {
    await requireAdmin();
    const [pending, verified, rejected, users] = await Promise.all([
      prisma.identityVerificationRequest.count({ where: { status: "PENDING" } }),
      prisma.identityVerificationRequest.count({ where: { status: "VERIFIED" } }),
      prisma.identityVerificationRequest.count({ where: { status: "REJECTED" } }),
      prisma.user.count(),
    ]);
    return Response.json({ pending, verified, rejected, users });
  } catch (error) {
    const status = (error as { status?: number }).status || 500;
    return jsonError(status === 401 ? "Sign in required" : status === 403 ? "Admin only" : "Could not load admin stats", status);
  }
}
