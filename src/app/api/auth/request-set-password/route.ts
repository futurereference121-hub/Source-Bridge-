import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createRawToken } from "@/lib/storage";
import { buildSetPasswordUrl, sendEmail } from "@/lib/email";
import { hashResetToken, resetTokenExpiresAt } from "@/lib/password-reset";
import {
  canAttemptIp,
  ipFromRequest,
  recordIpAttempt,
} from "@/lib/rate-limit";
import { jsonError, requestSetPasswordSchema } from "@/lib/validation";

/**
 * Always responds `{ ok: true }` regardless of whether the email exists —
 * prevents account enumeration. Only sends an email for verified accounts.
 * A newer request replaces older unused links at inspect/submit time.
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

    const user = await prisma.user.findUnique({ where: { email } });
    let previewUrl: string | null = null;

    if (user && !user.deletedAt && user.emailVerified) {
      const raw = createRawToken();
      const tokenHash = hashResetToken(raw);
      if (!tokenHash) {
        return Response.json({ ok: true });
      }
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: resetTokenExpiresAt(),
        },
      });
      const setPasswordUrl = buildSetPasswordUrl(raw);
      const action = user.passwordHash ? "reset" : "set";
      const sent = await sendEmail({
        to: email,
        subject: user.passwordHash
          ? "Reset your Source Bridge password"
          : "Set your Source Bridge password",
        verifyUrl: setPasswordUrl,
        text: `Hi ${user.name},\n\nOpen this link to ${action} your Source Bridge password:\n\n${setPasswordUrl}\n\nThis link expires in 1 hour and can only be used once. Opening it does not use it.\n\nIf you did not request this, ignore this email.`,
        html: `<p>Hi ${escapeHtml(user.name)},</p><p>Open this link to ${action} your Source Bridge password:</p><p><a href="${setPasswordUrl}">Set your password</a></p><p>This link expires in 1 hour and can only be used once. Opening it does not use it.</p>`,
      });
      previewUrl = sent.previewUrl ?? null;
    }

    recordIpAttempt(ip);
    return Response.json({ ok: true, previewUrl });
  } catch (err) {
    console.error("[request-set-password]", err);
    return Response.json({ ok: true });
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
