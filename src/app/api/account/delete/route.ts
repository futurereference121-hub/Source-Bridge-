import { NextRequest } from "next/server";
import { destroySession, isAdminUser, requireSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { canAttemptIp, clearIpAttempts, recordIpAttempt } from "@/lib/rate-limit";
import { deleteAccountSchema, jsonError } from "@/lib/validation";
import { deleteOwnAccount } from "@/lib/account-deletion";

const GENERIC_PASSWORD_ERROR = "Incorrect password";
const ADMIN_USERNAME = "adminsource";

/**
 * Self-service account deletion. Same-origin cookie session + Next.js
 * SameSite=Lax cookies are sufficient CSRF protection here — there is no
 * GET handler, so this can never be triggered by a plain link/image tag.
 */
async function handleDelete(req: NextRequest) {
  try {
    const user = await requireSessionUser();

    if (isAdminUser(user) || (user.username || "").toLowerCase() === ADMIN_USERNAME) {
      return jsonError("Administrator accounts cannot be deleted this way", 403);
    }

    const remainingAdmin = await prisma.user.findFirst({
      where: { id: user.id, deletedAt: null, OR: [{ role: "ADMIN" }, { isAdmin: true }] },
      select: { id: true },
    });
    if (remainingAdmin) {
      const adminCount = await prisma.user.count({
        where: { deletedAt: null, OR: [{ role: "ADMIN" }, { isAdmin: true }] },
      });
      if (adminCount <= 1) {
        return jsonError("Cannot delete the last administrator account", 403);
      }
    }

    const attemptKey = `account-delete:${user.id}`;
    if (!canAttemptIp(attemptKey, { maxAttempts: 5 })) {
      return jsonError("Too many attempts. Try again later.", 429);
    }

    const body = await req.json().catch(() => ({}));
    const parsed = deleteAccountSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    if (!dbUser) return jsonError("Sign in required", 401);
    if (!dbUser.passwordHash) {
      return jsonError(
        "Set a password before deleting your account",
        400,
        { code: "NEED_PASSWORD" },
      );
    }

    const validPassword = await verifyPassword(parsed.data.password, dbUser.passwordHash);
    if (!validPassword) {
      recordIpAttempt(attemptKey);
      return jsonError(GENERIC_PASSWORD_ERROR, 400);
    }
    clearIpAttempts(attemptKey);

    await deleteOwnAccount(user.id);
    try {
      await destroySession();
    } catch (err) {
      console.error("[account:delete] session clear failed after deletion", err);
    }

    return Response.json({ ok: true });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[account:delete]", error);
    const detail =
      process.env.NODE_ENV !== "production" && error instanceof Error
        ? error.message
        : "Could not delete account";
    return jsonError(detail, 500);
  }
}

export async function POST(req: NextRequest) {
  return handleDelete(req);
}

export async function DELETE(req: NextRequest) {
  return handleDelete(req);
}
