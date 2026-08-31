import { prisma } from "@/lib/db";
import { publicMemberWhere } from "@/lib/discoverability";
import { memberPhoto } from "@/lib/placeholders";
import { isWasLiveActive } from "./clock";
import type { LiveSessionPublic } from "./sessions";
import { toLiveSessionPublic } from "./sessions";

export type LiveDiscoverItem = LiveSessionPublic & {
  kind: "live" | "was_live";
};

export async function listDiscoverableLive(opts: {
  limit?: number;
  cursor?: string | null;
  now?: Date;
}): Promise<{ items: LiveDiscoverItem[]; nextCursor: string | null }> {
  const now = opts.now ?? new Date();
  const limit = Math.min(Math.max(opts.limit ?? 24, 1), 50);

  const rows = await prisma.liveSession.findMany({
    where: {
      OR: [
        { status: "LIVE" },
        {
          status: "ENDED",
          wasLiveUntil: { gt: now },
          endedReason: { not: "ADMIN" },
        },
      ],
      broadcaster: publicMemberWhere,
    },
    include: {
      broadcaster: {
        select: {
          id: true,
          username: true,
          slug: true,
          name: true,
          photo: true,
        },
      },
    },
    orderBy: [{ status: "asc" }, { startedAt: "desc" }, { createdAt: "desc" }],
    take: 200,
  });

  const live: LiveDiscoverItem[] = [];
  const was: LiveDiscoverItem[] = [];
  for (const row of rows) {
    if (!row.broadcaster.username || !row.broadcaster.slug) continue;
    const pub = toLiveSessionPublic(
      {
        ...row,
        broadcaster: {
          ...row.broadcaster,
          photo: memberPhoto(row.broadcaster.photo),
        },
      },
      now,
    );
    if (row.status === "LIVE") {
      live.push({ ...pub, kind: "live" });
    } else if (isWasLiveActive(row.wasLiveUntil, now)) {
      was.push({ ...pub, kind: "was_live" });
    }
  }

  live.sort(
    (a, b) =>
      Date.parse(b.startedAt || b.serverNow) -
      Date.parse(a.startedAt || a.serverNow),
  );
  was.sort(
    (a, b) =>
      Date.parse(b.endedAt || b.serverNow) - Date.parse(a.endedAt || a.serverNow),
  );

  const merged = [...live, ...was];
  let start = 0;
  if (opts.cursor) {
    const idx = merged.findIndex((i) => i.id === opts.cursor);
    start = idx >= 0 ? idx + 1 : 0;
  }
  const slice = merged.slice(start, start + limit);
  const last = slice[slice.length - 1];
  const more = start + slice.length < merged.length;
  return { items: slice, nextCursor: more && last ? last.id : null };
}

export type LivePresenceState = {
  kind: "live" | "was_live";
  sessionId: string;
  title: string;
};

export async function getLivePresence(
  userIds: string[],
  now: Date = new Date(),
): Promise<Record<string, LivePresenceState>> {
  const ids = [...new Set(userIds.filter(Boolean))].slice(0, 100);
  if (!ids.length) return {};
  const rows = await prisma.liveSession.findMany({
    where: {
      broadcasterId: { in: ids },
      OR: [
        { status: "LIVE" },
        { status: "ENDED", wasLiveUntil: { gt: now } },
      ],
    },
    select: {
      id: true,
      broadcasterId: true,
      status: true,
      title: true,
      startedAt: true,
      wasLiveUntil: true,
    },
  });
  const out: Record<string, LivePresenceState> = {};
  for (const row of rows) {
    const live = row.status === "LIVE";
    const was = row.status === "ENDED" && isWasLiveActive(row.wasLiveUntil, now);
    if (!live && !was) continue;
    const prev = out[row.broadcasterId];
    if (live) {
      out[row.broadcasterId] = {
        kind: "live",
        sessionId: row.id,
        title: row.title,
      };
      continue;
    }
    if (!prev) {
      out[row.broadcasterId] = {
        kind: "was_live",
        sessionId: row.id,
        title: row.title,
      };
    }
  }
  return out;
}
