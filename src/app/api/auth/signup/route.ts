import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, toPublicAccount } from "@/lib/auth";
import { createRawToken, hashToken } from "@/lib/storage";
import { sendVerificationEmail } from "@/lib/email";
import { VERIFY_TOKEN_TTL_MS } from "@/lib/limits";
import { hashPassword } from "@/lib/password";
import { jsonError, normalizeUsername, signupSchema } from "@/lib/validation";
import { ensureCategoriesSeeded } from "@/lib/categories-db";

export async function POST(req: NextRequest) {
  try {
    await ensureCategoriesSeeded();
    const body = await req.json();

    const parsed = signupSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }
    const { name, email, username, password, intent } = parsed.data;
    const normalizedEmail = email.toLowerCase();
    const normalizedUsername = normalizeUsername(username);

    const usernameTaken = await prisma.user.findFirst({
      where: { username: normalizedUsername, deletedAt: null },
      select: { id: true },
    });
    if (usernameTaken) {
      return jsonError("That username is already taken", 409);
    }

    const passwordHash = await hashPassword(password);
    const raw = createRawToken();
    const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);
    const tokenHash = hashToken(raw);

    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });
    if (existing) {
      if (existing.deletedAt) {
        return jsonError("Could not create account", 500);
      }
      if (existing.emailVerified) {
        return jsonError("An account with this email already exists. Sign in instead.", 409);
      }
      if (existing.passwordHash) {
        // Unverified account already has a password set — do not silently overwrite it.
        return jsonError("An account with this email already exists. Sign in instead.", 409);
      }

      // Unverified, passwordless placeholder — finish setup atomically.
      const updated = await prisma.$transaction(async (tx) => {
        const user = await tx.user.update({
          where: { id: existing.id },
          data: {
            name,
            username: normalizedUsername,
            slug: normalizedUsername,
            passwordHash,
            intent,
            emailVerified: false,
            onboardingComplete: false,
            isDiscoverable: true,
            isTestAccount: false,
            deletedAt: null,
          },
        });
        await tx.emailVerificationToken.create({
          data: {
            userId: user.id,
            tokenHash,
            email: normalizedEmail,
            expiresAt,
          },
        });
        return user;
      });

      const sent = await sendVerificationEmail({
        to: normalizedEmail,
        name: updated.name,
        token: raw,
      });
      await createSession(updated.id);
      return Response.json({
        ok: true,
        resent: true,
        account: toPublicAccount(updated),
        previewUrl: sent.previewUrl ?? null,
        next: "/check-email",
      });
    }

    // Atomic create: User + verification token succeed together or not at all.
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: normalizedEmail,
          name,
          username: normalizedUsername,
          slug: normalizedUsername,
          passwordHash,
          intent,
          emailVerified: false,
          identityVerified: false,
          identityVerificationStatus: "UNVERIFIED",
          photo: "",
          cover: "",
          bio: "",
          publicDisplayMessage: "",
          city: "",
          country: "",
          specialties: "[]",
          onboardingComplete: false,
          isDiscoverable: true,
          isTestAccount: false,
        },
      });
      await tx.emailVerificationToken.create({
        data: {
          userId: created.id,
          tokenHash,
          email: normalizedEmail,
          expiresAt,
        },
      });
      return created;
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
    if ((err as { code?: string })?.code === "P2002") {
      return jsonError("That email or username is already in use", 409);
    }
    console.error("[signup]", err instanceof Error ? err.message : err);
    return jsonError("Could not create account. Please try again.", 500);
  }
}
