import { VERIFY_TOKEN_TTL_MS } from "@/lib/limits";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export type PasswordSetupAccount = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  passwordHash: string | null;
  deletedAt: Date | null;
};

export type PasswordSetupDeps = {
  findUser: (email: string) => Promise<PasswordSetupAccount | null>;
  createVerificationToken: (data: {
    userId: string;
    tokenHash: string;
    email: string;
    expiresAt: Date;
  }) => Promise<void>;
  sendVerificationEmail: (opts: {
    to: string;
    name: string;
    token: string;
  }) => Promise<{ ok: boolean; previewUrl?: string | null }>;
  createPasswordResetToken: (data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }) => Promise<void>;
  sendPasswordEmail: (input: {
    to: string;
    subject: string;
    verifyUrl: string;
    text: string;
    html: string;
  }) => Promise<{ ok: boolean; previewUrl?: string | null }>;
  createRawToken: () => string;
  hashToken: (token: string) => string;
  buildSetPasswordUrl: (token: string) => string;
  now?: () => number;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Public password-setup request.
 * Unverified accounts receive the normal verification email.
 * Verified accounts keep the password-setup email.
 * Missing and deleted accounts send nothing.
 * This never marks an email verified, sets a password, or creates a session.
 */
export async function fulfillPasswordSetupRequest(
  email: string,
  deps: PasswordSetupDeps,
): Promise<{ previewUrl: string | null }> {
  const user = await deps.findUser(email);
  if (!user || user.deletedAt) return { previewUrl: null };

  const now = deps.now ? deps.now() : Date.now();
  const raw = deps.createRawToken();
  const tokenHash = deps.hashToken(raw);

  if (!user.emailVerified) {
    await deps.createVerificationToken({
      userId: user.id,
      tokenHash,
      email: user.email.toLowerCase(),
      expiresAt: new Date(now + VERIFY_TOKEN_TTL_MS),
    });
    const sent = await deps.sendVerificationEmail({
      to: email,
      name: user.name,
      token: raw,
    });
    return { previewUrl: sent.previewUrl ?? null };
  }

  await deps.createPasswordResetToken({
    userId: user.id,
    tokenHash,
    expiresAt: new Date(now + RESET_TOKEN_TTL_MS),
  });
  const setPasswordUrl = deps.buildSetPasswordUrl(raw);
  const action = user.passwordHash ? "reset" : "set";
  const sent = await deps.sendPasswordEmail({
    to: email,
    subject: user.passwordHash
      ? "Reset your Source Bridge password"
      : "Set your Source Bridge password",
    verifyUrl: setPasswordUrl,
    text: `Hi ${user.name},\n\nOpen this link to ${action} your Source Bridge password:\n${setPasswordUrl}\n\nThis link expires in 1 hour and can only be used once.\n\nIf you did not request this, ignore this email.`,
    html: `<p>Hi ${escapeHtml(user.name)},</p><p>Open this link to ${action} your Source Bridge password:</p><p><a href="${setPasswordUrl}">${setPasswordUrl}</a></p><p>This link expires in 1 hour and can only be used once.</p>`,
  });
  return { previewUrl: sent.previewUrl ?? null };
}
