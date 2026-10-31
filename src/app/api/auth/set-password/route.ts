import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, invalidateAllSessions, toPublicAccount } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import {
  evaluatePasswordResetToken,
  hashResetToken,
  normalizeResetToken,
  passwordResetClaimWhere,
  passwordResetError,
} from "@/lib/password-reset";
import { jsonError, setPasswordSchema } from "@/lib/validation";

function decisionResponse(
  decision: ReturnType<typeof evaluatePasswordResetToken>,
) {
  if (decision.ok) return Response.json({ ok: true, status: "ready" });
  return jsonError(decision.message, 400, { code: decision.code });
}

async function inspectResetToken(raw: unknown) {
  const tokenHash = hashResetToken(raw);
  if (!tokenHash) return passwordResetError("TOKEN_MISSING");

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { deletedAt: true } } },
  });
  if (!record) return passwordResetError("TOKEN_INVALID");

  const newer = await prisma.passwordResetToken.findFirst({
    where: {
      userId: record.userId,
      createdAt: { gt: record.createdAt },
    },
    select: { id: true },
  });

  return evaluatePasswordResetToken({
    record: {
      usedAt: record.usedAt,
      expiresAt: record.expiresAt,
      userDeletedAt: record.user.deletedAt,
    },
    newerTokenExists: Boolean(newer),
  });
}

/** Read-only. Email scanners and opening the page must not consume the token. */
export async function GET(req: NextRequest) {
  try {
    const token = normalizeResetToken(req.nextUrl.searchParams.get("token"));
    return decisionResponse(await inspectResetToken(token));
  } catch (err) {
    console.error("[set-password:inspect]", err);
    return jsonError("Could not check password link", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = setPasswordSchema.safeParse({
      ...body,
      token: normalizeResetToken(
        typeof body === "object" && body && "token" in body
          ? (body as { token?: unknown }).token
          : "",
      ),
    });
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }
    const { token, password } = parsed.data;
    const tokenHash = hashResetToken(token);
    if (!tokenHash) {
      const missing = passwordResetError("TOKEN_MISSING");
      return jsonError(missing.message, 400, { code: missing.code });
    }

    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    if (!record) {
      const invalid = passwordResetError("TOKEN_INVALID");
      return jsonError(invalid.message, 400, { code: invalid.code });
    }

    const newer = await prisma.passwordResetToken.findFirst({
      where: {
        userId: record.userId,
        createdAt: { gt: record.createdAt },
      },
      select: { id: true },
    });
    const decision = evaluatePasswordResetToken({
      record: {
        usedAt: record.usedAt,
        expiresAt: record.expiresAt,
        userDeletedAt: record.user.deletedAt,
      },
      newerTokenExists: Boolean(newer),
    });
    if (!decision.ok) {
      return jsonError(decision.message, 400, { code: decision.code });
    }

    const passwordHash = await hashPassword(password);
    const now = new Date();

    const claimed = await prisma.$transaction(async (tx) => {
      const replaced = await tx.passwordResetToken.findFirst({
        where: {
          userId: record.userId,
          createdAt: { gt: record.createdAt },
        },
        select: { id: true },
      });
      if (replaced) return { ok: false as const, code: "TOKEN_REPLACED" as const };

      const claim = await tx.passwordResetToken.updateMany({
        where: passwordResetClaimWhere(record.id, now),
        data: { usedAt: now },
      });
      if (claim.count !== 1) return { ok: false as const, code: "TOKEN_EXPIRED" as const };

      await tx.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null, id: { not: record.id } },
        data: { usedAt: now },
      });
      await tx.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          mustChangePassword: false,
          passwordChangedAt: now,
        },
      });
      return { ok: true as const };
    });

    if (!claimed.ok) {
      const again = await inspectResetToken(token);
      if (!again.ok) {
        return jsonError(again.message, 400, { code: again.code });
      }
      const failed = passwordResetError(claimed.code);
      return jsonError(failed.message, 400, { code: failed.code });
    }

    await invalidateAllSessions(record.userId);
    await createSession(record.userId);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: record.userId },
    });

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
