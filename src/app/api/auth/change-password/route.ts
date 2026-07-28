import { requireSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/password";
import { jsonError } from "@/lib/validation";

export async function POST(req: Request) {
  try {
    const user = await requireSessionUser();
    const body = await req.json().catch(() => ({}));
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const password = typeof body.password === "string" ? body.password : "";
    const userWithPassword = await prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    if (!userWithPassword?.passwordHash || !(await verifyPassword(currentPassword, userWithPassword.passwordHash))) {
      return jsonError("Current password is incorrect", 400);
    }
    const error = validatePasswordStrength(password);
    if (error) return jsonError(error, 400);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(password), mustChangePassword: false, passwordChangedAt: new Date() },
    });
    return Response.json({ ok: true });
  } catch (error) {
    const status = (error as { status?: number }).status;
    return jsonError(status === 401 ? "Sign in required" : "Could not change password", status || 500);
  }
}
