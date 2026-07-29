import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { createRawToken, hashToken } from "@/lib/storage";
import { buildSetPasswordUrl, sendEmail } from "@/lib/email";
import {
  canAttemptIp,
  ipFromRequest,
  recordIpAttempt,
} from "@/lib/rate-limit";
import { jsonError, requestSetPasswordSchema } from "@/lib/validation";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Always responds `{ ok: true }` regardless of whether the email exists —
 * prevents account enumeration. Only sends an email for verified accounts.
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
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(raw),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });
      const setPasswordUrl = buildSetPasswordUrl(raw);
      const sent = await sendEmail({
        to: email,
        subject: user.passwordHash
          ? "Reset your Source Bridge password"
          : "Set your Source Bridge password",
        verifyUrl: setPasswordUrl,
        text: `Hi ${user.name},\n\nOpen this link to ${
          user.passwordHash ? "reset" : "set"
        } your Source Bridge password:\n${setPasswordUrl}\n\nThis link expires in 1 hour and can only be used once.\n\nIf you did not request this, ignore this email.`,
        html: `<p>Hi ${escapeHtml(user.name)},</p><p>Open this link to ${
          user.passwordHash ? "reset" : "set"
        } your Source Bridge password:</p><p><a href="${setPasswordUrl}">${setPasswordUrl}</a></p><p>This link expires in 1 hour and can only be used once.</p>`,
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
