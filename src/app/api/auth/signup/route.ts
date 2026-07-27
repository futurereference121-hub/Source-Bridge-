import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, toPublicAccount } from "@/lib/auth";
import { createRawToken, hashToken } from "@/lib/storage";
import { sendVerificationEmail } from "@/lib/email";
import { VERIFY_TOKEN_TTL_MS } from "@/lib/limits";
import { jsonError, signupSchema } from "@/lib/validation";
import { ensureCategoriesSeeded } from "@/lib/categories-db";

export async function POST(req: NextRequest) {
  try {
    await ensureCategoriesSeeded();
    const body = await req.json();

    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }
    const { name, email, intent } = parsed.data;
    const normalizedEmail = email.toLowerCase();

    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      if (existing.emailVerified) {
        return jsonError("An account with this email already exists. Sign in instead.", 409);
      }
      // Unverified — refresh token and resend
      const raw = createRawToken();
      const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);
      await prisma.emailVerificationToken.create({
        data: {
          userId: existing.id,
          tokenHash: hashToken(raw),
          email: normalizedEmail,
          expiresAt,
        },
      });
      const sent = await sendVerificationEmail({
        to: normalizedEmail,
        name: existing.name,
        token: raw,
      });
      await createSession(existing.id);
      return Response.json({
        ok: true,
        resent: true,
        account: toPublicAccount({
          ...existing,
          emailVerified: false,
        }),
        previewUrl: sent.previewUrl ?? null,
        next: "/check-email",
      });
    }

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name,
        intent,
        emailVerified: false,
        identityVerified: false,
        photo: "",
        cover: "",
        bio: "",
        publicDisplayMessage: "",
        city: "",
        country: "",
        specialties: "[]",
        onboardingComplete: false,
      },
    });

    const raw = createRawToken();
    const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);
    await prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(raw),
        email: normalizedEmail,
        expiresAt,
      },
    });

    const sent = await sendVerificationEmail({
      to: normalizedEmail,
      name,
      token: raw,
    });

    await createSession(user.id);

    return Response.json({
      ok: true,
      account: toPublicAccount(user),
      previewUrl: sent.previewUrl ?? null,
      next: "/check-email",
    });
  } catch (err) {
    console.error("[signup]", err);
    return jsonError("Could not create account", 500);
  }
}
