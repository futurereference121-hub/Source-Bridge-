import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createRawToken, hashToken } from "@/lib/storage";
import { buildSetPasswordUrl, sendEmail, sendVerificationEmail } from "@/lib/email";
import { fulfillPasswordSetupRequest } from "@/lib/auth/password-setup-request";
import {
  canAttemptIp,
  ipFromRequest,
  recordIpAttempt,
} from "@/lib/rate-limit";
import { jsonError, requestSetPasswordSchema } from "@/lib/validation";

/**
 * Always responds `{ ok: true }` when the request is accepted —
 * prevents account enumeration.
 * Verified accounts receive a password-setup link.
 * Unverified accounts receive the normal verification email.
 * Unknown and deleted addresses receive nothing.
 * This request does not verify the account, set a password, or create a session.
 */
export async function POST(req: NextRequest) {
  const ip = ipFromRequest(req);
  if (!canAttemptIp(ip, { maxAttempts: 8 })) {
    return jsonError("Too many requests. Try again later.", 429);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const parsed = requestSetPasswordSchema.safeParse(body);
    if (!parsed.success) {
      recordIpAttempt(ip);
      return jsonError(parsed.error.issues[0]?.message || "Invalid input", 400);
    }
    const email = parsed.data.email.toLowerCase();
    const { previewUrl } = await fulfillPasswordSetupRequest(email, {
      findUser: (address) =>
        prisma.user.findUnique({
          where: { email: address },
          select: {
            id: true,
            name: true,
            email: true,
            emailVerified: true,
            passwordHash: true,
            deletedAt: true,
          },
        }),
      createVerificationToken: (data) =>
        prisma.emailVerificationToken.create({ data }).then(() => undefined),
      sendVerificationEmail: (opts) => sendVerificationEmail(opts),
      createPasswordResetToken: (data) =>
        prisma.passwordResetToken.create({ data }).then(() => undefined),
      sendPasswordEmail: (input) => sendEmail(input),
      createRawToken,
      hashToken,
      buildSetPasswordUrl,
    });

    recordIpAttempt(ip);
    return Response.json({ ok: true, previewUrl });
  } catch (err) {
    console.error("[request-set-password]", err);
    return Response.json({ ok: true });
  }
}
