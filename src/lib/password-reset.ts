/**
 * Password set/reset token policy.
 * Opening a link never consumes it. Claim is atomic and only after a successful
 * password change in the same database transaction.
 */
import { createHash } from "node:crypto";

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export type PasswordResetCode =
  | "TOKEN_MISSING"
  | "TOKEN_INVALID"
  | "TOKEN_USED"
  | "TOKEN_REPLACED"
  | "TOKEN_EXPIRED";

export type PasswordResetDecision =
  | { ok: true }
  | { ok: false; code: PasswordResetCode; message: string };

const RESET_MESSAGES: Record<PasswordResetCode, string> = {
  TOKEN_MISSING: "Missing token",
  TOKEN_INVALID: "This password link is invalid.",
  TOKEN_USED: "This link has already been used",
  TOKEN_REPLACED:
    "This link was replaced by a newer request. Use the latest email or request a new one.",
  TOKEN_EXPIRED: "This link has expired",
};

/** Opening / prefetching the reset page must never mark the token used. */
export const PASSWORD_RESET_OPEN_CONSUMES = false;

export function passwordResetError(
  code: PasswordResetCode,
): Extract<PasswordResetDecision, { ok: false }> {
  return { ok: false, code, message: RESET_MESSAGES[code] };
}

/**
 * Email clients wrap URLs and quoted-printable can inject whitespace or `=`.
 * Tokens we issue are hex, so those leftovers can be stripped safely.
 */
export function normalizeResetToken(raw: unknown): string {
  let token = String(raw ?? "").trim();
  if (!token) return "";
  try {
    if (/%[0-9A-Fa-f]{2}/.test(token)) {
      token = decodeURIComponent(token);
    }
  } catch {
    // Keep the trimmed value if it was not valid percent-encoding.
  }
  return token.replace(/[\s<>"]+/g, "").replace(/=+$/g, "");
}

export function hashResetToken(raw: unknown): string | null {
  const token = normalizeResetToken(raw);
  if (!token) return null;
  return createHash("sha256").update(token).digest("hex");
}

export function evaluatePasswordResetToken(opts: {
  record:
    | {
        usedAt: Date | null;
        expiresAt: Date;
        userDeletedAt?: Date | null;
      }
    | null;
  newerTokenExists: boolean;
  nowMs?: number;
}): PasswordResetDecision {
  if (!opts.record) return passwordResetError("TOKEN_INVALID");
  if (opts.record.userDeletedAt) return passwordResetError("TOKEN_INVALID");
  if (opts.record.usedAt) return passwordResetError("TOKEN_USED");
  if (opts.newerTokenExists) return passwordResetError("TOKEN_REPLACED");
  const nowMs = opts.nowMs ?? Date.now();
  const expiresMs = new Date(opts.record.expiresAt).getTime();
  if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) {
    return passwordResetError("TOKEN_EXPIRED");
  }
  return { ok: true };
}

/** Prisma where-clause for the single-row claim. Caller must run this with the password write. */
export function passwordResetClaimWhere(id: string, now: Date) {
  return {
    id,
    usedAt: null,
    expiresAt: { gt: now },
  };
}

export function resetTokenExpiresAt(nowMs = Date.now()): Date {
  return new Date(nowMs + RESET_TOKEN_TTL_MS);
}
