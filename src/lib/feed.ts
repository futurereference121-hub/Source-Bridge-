import type { FeedItem, Member } from "@/lib/types";
import { isStatusActive } from "@/lib/member-status";

/**
 * Derive a single chronological live feed from members.
 * Mix of status updates and opportunity posts — no social features.
 */
export function buildLiveFeed(
  members: Member[],
  now: Date = new Date(),
): FeedItem[] {
  const items: FeedItem[] = [];

  for (const member of members) {
    if (isStatusActive(member.status, now) && member.status) {
      items.push({
        id: `status-${member.id}`,
        kind: "status",
        memberId: member.id,
        memberSlug: member.slug,
        username: member.username,
        fullName: member.fullName,
        photo: member.photo,
        text: member.status.text,
        postedAt: member.status.postedAt,
        expiresAt: member.status.expiresAt,
      });
    }

    if (member.opportunity) {
      const o = member.opportunity;
      items.push({
        id: `opp-${o.id}`,
        kind: "opportunity",
        memberId: member.id,
        memberSlug: member.slug,
        username: member.username,
        fullName: member.fullName,
        photo: member.photo,
        text: o.summary,
        postedAt: o.postedAt,
      });
    }
  }

  return items.sort(
    (a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt),
  );
}

/** Filter feed items that match a search query (optional). */
export function filterFeedByQuery(
  items: FeedItem[],
  matchingMemberIds: Set<string> | null,
): FeedItem[] {
  if (!matchingMemberIds) return items;
  return items.filter((item) => matchingMemberIds.has(item.memberId));
}
