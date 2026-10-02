/** Rejection for a verification token before any account update. */
export function verificationTokenRejection(
  record: { usedAt: Date | null; expiresAt: Date } | null,
  now = Date.now(),
): { error: string; code?: "TOKEN_USED" | "TOKEN_EXPIRED" } | null {
  if (!record) return { error: "Invalid verification link" };
  if (record.usedAt) {
    return { error: "This verification link has already been used", code: "TOKEN_USED" };
  }
  if (record.expiresAt.getTime() <= now) {
    return { error: "This verification link has expired", code: "TOKEN_EXPIRED" };
  }
  return null;
}
