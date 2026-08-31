import type { FeedItem } from "@/lib/types";
import { listDiscoverableLive } from "./discovery";

export async function liveFeedItems(
  limit: number,
  now: Date = new Date(),
): Promise<FeedItem[]> {
  const { items } = await listDiscoverableLive({ limit, now });
  return items.map((item) => ({
    id: `live-${item.id}`,
    kind: item.kind === "live" ? "live" : "was_live",
    memberId: item.broadcaster.id,
    memberSlug: item.broadcaster.slug || "",
    username: item.broadcaster.username || "",
    fullName: item.broadcaster.name,
    photo: item.broadcaster.photo,
    text:
      item.kind === "live"
        ? item.title
        : `Was Live · ${item.title}`,
    city: item.locationLabel,
    postedAt: item.startedAt || item.endedAt || item.serverNow,
    expiresAt: item.kind === "live" ? item.endsAt || undefined : item.wasLiveUntil || undefined,
    liveSessionId: item.id,
    liveKind: item.kind,
  }));
}
