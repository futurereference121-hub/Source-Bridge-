import { prisma } from "@/lib/db";
import type { NotificationType } from "@/lib/types";

const TITLE_MAX = 200;
const BODY_MAX = 300;

export type CreateNotificationInput = {
  userId: string;
  type: NotificationType;
  title: string;
  /** Short teaser only — NEVER include private message bodies. */
  body?: string;
  href?: string;
  actorId?: string | null;
  actorName?: string;
  /** When set, skip insert if this user already has a row with the same key. */
  dedupeKey?: string | null;
};

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

/** Insert one notification. No-ops (and never throws) when userId === actorId. */
export async function createNotification(
  input: CreateNotificationInput,
): Promise<void> {
  if (!input.userId) return;
  if (input.actorId && input.actorId === input.userId) return;
  const dedupeKey = (input.dedupeKey || "").trim() || null;
  try {
    if (dedupeKey) {
      const existing = await prisma.notification.findFirst({
        where: { userId: input.userId, dedupeKey },
        select: { id: true },
      });
      if (existing) return;
    }
    await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: clip(input.title, TITLE_MAX),
        body: clip(input.body || "", BODY_MAX),
        href: input.href || "",
        actorId: input.actorId || null,
        actorName: input.actorName || "",
        dedupeKey,
      },
    });
  } catch (err) {
    console.error("[notifications] createNotification failed", err);
  }
}

/** Batch insert — silently drops self-notifications, never throws. */
export async function createNotifications(
  inputs: CreateNotificationInput[],
): Promise<void> {
  const rows = inputs.filter(
    (i) => i.userId && (!i.actorId || i.actorId !== i.userId),
  );
  if (!rows.length) return;
  try {
    const withDedupe = rows.filter((i) => (i.dedupeKey || "").trim());
    const withoutDedupe = rows.filter((i) => !(i.dedupeKey || "").trim());
    if (withDedupe.length) {
      const existing = await prisma.notification.findMany({
        where: {
          OR: withDedupe.map((i) => ({
            userId: i.userId,
            dedupeKey: (i.dedupeKey || "").trim(),
          })),
        },
        select: { userId: true, dedupeKey: true },
      });
      const seen = new Set(
        existing.map((e) => `${e.userId}:${e.dedupeKey || ""}`),
      );
      for (const i of withDedupe) {
        const key = `${i.userId}:${(i.dedupeKey || "").trim()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await createNotification(i);
      }
    }
    if (withoutDedupe.length) {
      await prisma.notification.createMany({
        data: withoutDedupe.map((i) => ({
          userId: i.userId,
          type: i.type,
          title: clip(i.title, TITLE_MAX),
          body: clip(i.body || "", BODY_MAX),
          href: i.href || "",
          actorId: i.actorId || null,
          actorName: i.actorName || "",
          dedupeKey: null,
        })),
      });
    }
  } catch (err) {
    console.error("[notifications] createNotifications failed", err);
  }
}

export type NotifyFollowersOfPostInput = {
  authorId: string;
  authorName: string;
  kind: "STATUS" | "OPPORTUNITY";
  text: string;
  href: string;
};

/** Fan out a new status/opportunity post to every real-user follower. */
export async function notifyFollowersOfPost({
  authorId,
  authorName,
  kind,
  text,
  href,
}: NotifyFollowersOfPostInput): Promise<void> {
  try {
    const rows = await prisma.follow.findMany({
      where: { followingId: authorId, followingIsSeed: false },
      select: { followerId: true },
    });
    if (!rows.length) return;

    const title =
      kind === "OPPORTUNITY"
        ? `${authorName} posted a new opportunity`
        : `${authorName} shared a new status`;

    await createNotifications(
      rows.map((r) => ({
        userId: r.followerId,
        type: kind,
        title,
        body: clip(text, 140),
        href,
        actorId: authorId,
        actorName: authorName,
      })),
    );
  } catch (err) {
    console.error("[notifications] notifyFollowersOfPost failed", err);
  }
}
