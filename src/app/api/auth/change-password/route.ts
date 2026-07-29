import { createSession, invalidateAllSessions, requireSessionUser, toPublicAccount } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { changePasswordSchema, jsonError } from "@/lib/validation";

export async function POST(req: Request) {
  try {
    const sessionUser = await requireSessionUser();
    const body = await req.json().catch(() => ({}));
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }
    const { currentPassword, password } = parsed.data;

    const userWithPassword = await prisma.user.findUnique({
      where: { id: sessionUser.id },
      select: { passwordHash: true },
    });
    if (!userWithPassword) return jsonError("Sign in required", 401);

    if (userWithPassword.passwordHash) {
      // Changing an existing password requires the current one.
      if (!currentPassword || !(await verifyPassword(currentPassword, userWithPassword.passwordHash))) {
        return jsonError("Current password is incorrect", 400);
      }
    } else if (!sessionUser.emailVerified) {
      // Setting a password for the first time requires a verified email.
      return jsonError("Verify your email before setting a password", 403);
    }

    const passwordHash = await hashPassword(password);
    await invalidateAllSessions(sessionUser.id);
    await prisma.user.update({
      where: { id: sessionUser.id },
      data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() },
    });

    await createSession(sessionUser.id);
    const fresh = await prisma.user.findUniqueOrThrow({ where: { id: sessionUser.id } });

    return Response.json({ ok: true, account: toPublicAccount(fresh) });
  } catch (error) {
    const status = (error as { status?: number }).status;
    return jsonError(status === 401 ? "Sign in required" : "Could not change password", status || 500);
  }
}
