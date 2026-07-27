import type { MemberStatus } from "@/lib/types";

/** Status is active only when expiresAt is in the future. */
export function isStatusActive(
  status: MemberStatus | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!status?.text?.trim()) return false;
  const expires = Date.parse(status.expiresAt);
  if (Number.isNaN(expires)) return false;
  return expires > now.getTime();
}

/** Build a 24h status from now (prototype helper). */
export function createStatus(
  text: string,
  now: Date = new Date(),
): MemberStatus {
  const postedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  return { text: text.trim(), postedAt, expiresAt };
}
