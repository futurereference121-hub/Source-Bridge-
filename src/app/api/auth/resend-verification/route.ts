import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, getSessionUser, toPublicAccount } from "@/lib/auth";
import { createRawToken, hashToken } from "@/lib/storage";
import { sendVerificationEmail } from "@/lib/email";
import { VERIFY_TOKEN_TTL_MS } from "@/lib/limits";
import { changeEmailSchema, jsonError } from "@/lib/validation";

export async function POST() {
  try {
    const user = await getSessionUser();
    if (!user) return jsonError("Sign in required", 401);
    if (user.emailVerified) {
      return Response.json({ ok: true, alreadyVerified: true });
    }

    const raw = createRawToken();
    await prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(raw),
        email: user.email,
        expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
      },
    });
    const sent = await sendVerificationEmail({
      to: user.email,
      name: user.name,
      token: raw,
    });

    return Response.json({
      ok: true,
      previewUrl: sent.previewUrl ?? null,
      message: "Verification email resent",
    });
  } catch (err) {
    console.error("[resend]", err);
    return jsonError("Could not resend verification", 500);
  }
}

/** Change email for unverified accounts and resend. */
export async function PUT(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return jsonError("Sign in required", 401);
    if (user.emailVerified) {
      return jsonError("Email already verified. Change email from Account Settings later.", 400);
    }

    const body = await req.json();
    const parsed = changeEmailSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid email", 400);
    }
    const email = parsed.data.email.toLowerCase();

    if (email !== user.email) {
      const taken = await prisma.user.findUnique({ where: { email } });
      if (taken) return jsonError("That email is already in use", 409);
      await prisma.user.update({
        where: { id: user.id },
        data: { email },
      });
    }

    const raw = createRawToken();
    await prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(raw),
        email,
        expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
      },
    });
    const sent = await sendVerificationEmail({
      to: email,
      name: user.name,
      token: raw,
    });

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    await createSession(updated.id);

    return Response.json({
      ok: true,
      account: toPublicAccount(updated),
      previewUrl: sent.previewUrl ?? null,
      message: "Email updated — check your inbox",
    });
  } catch (err) {
    console.error("[change-email]", err);
    return jsonError("Could not change email", 500);
  }
}
