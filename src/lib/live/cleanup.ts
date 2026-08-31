import { prisma } from "@/lib/db";
import { LIVE_PREPARING_TTL_MS } from "./constants";
import { isLiveExpired } from "./clock";
import { cleanupLiveProvider, endLiveSession } from "./sessions";

export type LiveCleanupResult = {
  expiredLive: number;
  abandonedPreparing: number;
  recordingRetries: number;
  recordingDone: number;
};

export async function runLiveCleanup(now: Date = new Date()): Promise<LiveCleanupResult> {
  const preparingCutoff = new Date(now.getTime() - LIVE_PREPARING_TTL_MS);

  const expired = await prisma.liveSession.findMany({
    where: { status: "LIVE", endsAt: { lte: now } },
    select: { id: true, endsAt: true },
    take: 50,
  });
  let expiredLive = 0;
  for (const row of expired) {
    if (!isLiveExpired(row.endsAt, now)) continue;
    await endLiveSession({ sessionId: row.id, reason: "EXPIRED", now });
    expiredLive += 1;
  }

  const abandoned = await prisma.liveSession.findMany({
    where: { status: "PREPARING", createdAt: { lte: preparingCutoff } },
    select: { id: true },
    take: 50,
  });
  let abandonedPreparing = 0;
  for (const row of abandoned) {
    await endLiveSession({
      sessionId: row.id,
      reason: "ABANDONED",
      now,
    });
    abandonedPreparing += 1;
  }

  const retries = await prisma.liveSession.findMany({
    where: {
      recordingCleanupStatus: { in: ["PENDING", "FAILED"] },
      recordingCleanupAttempts: { lt: 8 },
      status: { in: ["ENDED", "TERMINATED", "FAILED"] },
    },
    orderBy: { endedAt: "asc" },
    take: 20,
    select: { id: true },
  });
  let recordingRetries = 0;
  let recordingDone = 0;
  for (const row of retries) {
    recordingRetries += 1;
    await cleanupLiveProvider(row.id);
    const after = await prisma.liveSession.findUnique({
      where: { id: row.id },
      select: { recordingCleanupStatus: true },
    });
    if (after?.recordingCleanupStatus === "DONE") recordingDone += 1;
  }

  return { expiredLive, abandonedPreparing, recordingRetries, recordingDone };
}
