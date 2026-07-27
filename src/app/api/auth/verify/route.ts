import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, toPublicAccount } from "@/lib/auth";
import { hashToken } from "@/lib/storage";
import { jsonError } from "@/lib/validation";

/**
 * Validate a single-use email verification token.
 * Marks emailVerified ONLY — never identityVerified.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) return jsonError("Missing token", 400);

    const tokenHash = hashToken(token);
    const record = await prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!record) return jsonError("Invalid verification link", 400);
    if (record.usedAt) {
      return jsonError("This verification link has already been used", 400, {
        code: "TOKEN_USED",
      });
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      return jsonError("This verification link has expired", 400, {
        code: "TOKEN_EXPIRED",
      });
    }

    await prisma.$transaction([
      prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      prisma.user.update({
        where: { id: record.userId },
        data: {
          email: record.email.toLowerCase(),
          emailVerified: true,
          // identityVerified intentionally untouched
        },
      }),
      // Invalidate other unused tokens for this user
      prisma.emailVerificationToken.updateMany({
        where: {
          userId: record.userId,
          usedAt: null,
          id: { not: record.id },
        },
        data: { usedAt: new Date() },
      }),
    ]);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: record.userId },
    });

    await createSession(user.id);

    const next = user.onboardingComplete ? "/explore" : "/onboarding";

    return Response.json({
      ok: true,
      account: toPublicAccount(user),
      next,
    });
  } catch (err) {
    console.error("[verify]", err);
    return jsonError("Could not verify email", 500);
  }
}
