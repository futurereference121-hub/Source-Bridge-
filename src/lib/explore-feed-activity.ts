import { prisma } from "@/lib/db";
import { publicMemberWhere } from "@/lib/discoverability";
import type { FeedItem } from "@/lib/types";

/**
 * Lightweight Explore Live-feed activity fingerprint.
 * Equality-only: includes an id-signature so Status replace (same count,
 * possibly dominated max timestamp) still differs from the prior value.
 */
export type ExploreFeedVersionParts = {
  statusMaxMs: number;
  statusCount: number;
  statusIdSig: string;
  opportunityMaxMs: number;
  opportunityCount: number;
  opportunityIdSig: string;
};

/** Stable short signature over active row ids (order-independent). */
export function idSignature(ids: string[]): string {
  const sorted = [...ids].sort();
  let h = 2166136261;
  for (let i = 0; i < sorted.length; i++) {
    const id = sorted[i]!;
    for (let j = 0; j < id.length; j++) {
      h ^= id.charCodeAt(j);
      h = Math.imul(h, 16777619);
    }
    h ^= 0x2c; // ','
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function encodeExploreFeedVersion(parts: ExploreFeedVersionParts): string {
  return `s${parts.statusMaxMs}c${parts.statusCount}i${parts.statusIdSig}|o${parts.opportunityMaxMs}c${parts.opportunityCount}i${parts.opportunityIdSig}`;
}

export function maxFeedContentVersion(items: FeedItem[]): number {
  let max = 0;
  for (const item of items) {
    const ts = Date.parse(item.postedAt);
    if (Number.isFinite(ts) && ts > max) max = ts;
  }
  return max;
}

/**
 * Cheap activity check — ids + aggregates only (no member joins / feed rows).
 */
export async function getExploreFeedVersion(
  now: Date = new Date(),
): Promise<string> {
  const [statuses, opportunities] = await Promise.all([
    prisma.statusUpdate.findMany({
      where: {
        expiresAt: { gt: now },
        user: publicMemberWhere,
      },
      select: { id: true, postedAt: true },
    }),
    prisma.opportunity.findMany({
      where: {
        closedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        user: publicMemberWhere,
      },
      select: { id: true, postedAt: true },
    }),
  ]);

  let statusMaxMs = 0;
  for (const s of statuses) {
    const t = s.postedAt.getTime();
    if (t > statusMaxMs) statusMaxMs = t;
  }
  let opportunityMaxMs = 0;
  for (const o of opportunities) {
    const t = o.postedAt.getTime();
    if (t > opportunityMaxMs) opportunityMaxMs = t;
  }

  return encodeExploreFeedVersion({
    statusMaxMs,
    statusCount: statuses.length,
    statusIdSig: idSignature(statuses.map((s) => s.id)),
    opportunityMaxMs,
    opportunityCount: opportunities.length,
    opportunityIdSig: idSignature(opportunities.map((o) => o.id)),
  });
}

/**
 * Stale-response guard for overlapping feed fetches.
 * Prefer server feedVersion equality; fall back to content max timestamp
 * only when the payload has no version (legacy).
 */
export function shouldApplyExploreFeedPayload(opts: {
  requestSeq: number;
  latestSeq: number;
  incomingVersion: string | null | undefined;
  appliedVersion: string;
  incomingContentMax: number;
  appliedContentMax: number;
}): boolean {
  if (opts.requestSeq !== opts.latestSeq) return false;
  if (opts.incomingVersion) {
    // Equality-only activity fingerprint — any change (incl. expiry/replace) applies.
    if (opts.incomingVersion === opts.appliedVersion) return false;
    return true;
  }
  // Legacy: ignore non-empty older Status/Opportunity content clocks.
  if (
    opts.incomingContentMax > 0 &&
    opts.incomingContentMax < opts.appliedContentMax
  ) {
    return false;
  }
  return true;
}
