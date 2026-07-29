import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, invalidateAllSessions, toPublicAccount } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { hashToken } from "@/lib/storage";
import { jsonError, setPasswordSchema } from "@/lib/validation";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = setPasswordSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }
    const { token, password } = parsed.data;

    const tokenHash = hashToken(token);
    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!record) return jsonError("Invalid or expired link", 400);
    if (record.usedAt) {
      return jsonError("This link has already been used", 400, { code: "TOKEN_USED" });
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      return jsonError("This link has expired", 400, { code: "TOKEN_EXPIRED" });
    }
    if (record.user.deletedAt) {
      return jsonError("Invalid or expired link", 400);
    }

    const passwordHash = await hashPassword(password);

    await prisma.$transaction([
      prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      prisma.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null, id: { not: record.id } },
        data: { usedAt: new Date() },
      }),
      prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() },
      }),
    ]);

    await invalidateAllSessions(record.userId);
    await createSession(record.userId);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: record.userId } });

    return Response.json({
      ok: true,
      account: toPublicAccount(user),
      next: user.onboardingComplete ? "/explore" : "/onboarding",
    });
  } catch (err) {
    console.error("[set-password]", err);
    return jsonError("Could not set password", 500);
  }
}
