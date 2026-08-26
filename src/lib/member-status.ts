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

type StatusRow = {
  text: string;
  postedAt: Date;
  expiresAt: Date;
};

/**
 * ONE authoritative “current active Status” for a user:
 * newest StatusUpdate row whose expiresAt is still in the future.
 * Used by profile mapping, Explore feed, and member cards.
 */
export function pickActiveStatus(
  statuses: StatusRow[] | null | undefined,
  now: Date = new Date(),
): MemberStatus | null {
  if (!statuses?.length) return null;
  const sorted = [...statuses].sort(
    (a, b) => b.postedAt.getTime() - a.postedAt.getTime(),
  );
  for (const row of sorted) {
    const mapped: MemberStatus = {
      text: row.text,
      postedAt: row.postedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    };
    if (isStatusActive(mapped, now)) return mapped;
  }
  return null;
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
