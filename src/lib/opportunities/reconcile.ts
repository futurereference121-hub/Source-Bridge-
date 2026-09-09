import { prisma } from "@/lib/db";
import { createNotification } from "@/lib/notifications";
import { isInPreExpiryWindow, isPastExpiry } from "@/lib/opportunities/expiry";
import { PUBLIC_ACTIVE_LIFECYCLES } from "@/lib/opportunities/lifecycle";

/**
 * Bounded Opportunity reconciliation — expiry + pre-expiry renew nudges.
 * Safe for cron: hard take limits, no per-opportunity HTTP, no Ably.
 */
export async function reconcileOpportunities(limit = 100): Promise<{
  expired: number;
  preExpiryNotified: number;
}> {
  const now = new Date();
  let expired = 0;
  let preExpiryNotified = 0;

  const due = await prisma.opportunity.findMany({
    where: {
      lifecycle: { in: [...PUBLIC_ACTIVE_LIFECYCLES] },
      closedAt: null,
      expiresAt: { lte: now },
    },
    select: { id: true },
    take: limit,
    orderBy: { expiresAt: "asc" },
  });

  if (due.length) {
    const result = await prisma.opportunity.updateMany({
      where: { id: { in: due.map((d) => d.id) } },
      data: {
        lifecycle: "EXPIRED",
        stateChangedAt: now,
      },
    });
    expired = result.count;
  }

  const soon = await prisma.opportunity.findMany({
    where: {
      lifecycle: { in: [...PUBLIC_ACTIVE_LIFECYCLES] },
      closedAt: null,
      preExpiryNotifiedAt: null,
      expiresAt: {
        gt: now,
        lte: new Date(now.getTime() + 48 * 60 * 60 * 1000),
      },
    },
    select: {
      id: true,
      userId: true,
      title: true,
      expiresAt: true,
    },
    take: Math.min(limit, 50),
    orderBy: { expiresAt: "asc" },
  });

  for (const row of soon) {
    if (!isInPreExpiryWindow(row.expiresAt, now)) continue;
    if (isPastExpiry(row.expiresAt, now)) continue;
    try {
      await createNotification({
        userId: row.userId,
        type: "OPPORTUNITY_RENEW",
        title: "Still available? Renew opportunity",
        body: `“${row.title.slice(0, 80)}” expires soon. Renew to keep it visible.`,
        href: "/opportunities?mine=1",
        dedupeKey: `opportunity-renew:${row.id}`,
      });
      await prisma.opportunity.update({
        where: { id: row.id },
        data: { preExpiryNotifiedAt: now },
      });
      preExpiryNotified += 1;
    } catch (err) {
      console.error("[opportunity:pre-expiry]", row.id, err);
    }
  }

  return { expired, preExpiryNotified };
}
