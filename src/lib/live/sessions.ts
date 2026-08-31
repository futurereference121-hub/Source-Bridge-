import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import {
  LIVE_LOCATION_MAX,
  LIVE_PREPARING_TTL_MS,
  LIVE_PROVIDER_CLOUDFLARE,
  LIVE_TITLE_MAX,
  type LiveEndedReason,
} from "./constants";
import {
  isLiveExpired,
  liveCooldownUntil,
  liveEndsAt,
  liveWasLiveUntil,
} from "./clock";
import {
  evaluateLiveEligibility,
  throwEligibilityHttp,
} from "./eligibility";
import { getLiveVideoProvider } from "./get-provider";
import { isLiveStreamingAvailable } from "./flags";

import type { LiveSessionPublic } from "./public-types";

export type { LiveSessionPublic } from "./public-types";

function httpError(message: string, status: number, code?: string): never {
  const err = new Error(message) as Error & { status: number; code?: string };
  err.status = status;
  if (code) err.code = code;
  throw err;
}

function normalizeTitle(raw: string): string {
  const title = raw.replace(/\s+/g, " ").trim();
  if (title.length < 2) httpError("Title is required", 400, "TITLE_REQUIRED");
  if (title.length > LIVE_TITLE_MAX) {
    httpError(`Title must be ${LIVE_TITLE_MAX} characters or fewer`, 400);
  }
  return title;
}

function normalizeLocation(raw: string): string {
  const location = raw.replace(/\s+/g, " ").trim();
  if (location.length < 2) {
    httpError("Public location is required", 400, "LOCATION_REQUIRED");
  }
  if (location.length > LIVE_LOCATION_MAX) {
    httpError(
      `Location must be ${LIVE_LOCATION_MAX} characters or fewer`,
      400,
    );
  }
  return location;
}

export function toLiveSessionPublic(
  row: {
    id: string;
    status: string;
    title: string;
    locationLabel: string;
    startedAt: Date | null;
    endsAt: Date | null;
    endedAt: Date | null;
    cooldownUntil: Date | null;
    wasLiveUntil: Date | null;
    endedReason: string;
    version: number;
    broadcaster: {
      id: string;
      username: string | null;
      slug: string | null;
      name: string;
      photo: string;
    };
  },
  now: Date = new Date(),
): LiveSessionPublic {
  const remainingMs =
    row.status === "LIVE" && row.endsAt
      ? Math.max(0, row.endsAt.getTime() - now.getTime())
      : 0;
  return {
    id: row.id,
    status: row.status,
    title: row.title,
    locationLabel: row.locationLabel,
    startedAt: row.startedAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    cooldownUntil: row.cooldownUntil?.toISOString() ?? null,
    wasLiveUntil: row.wasLiveUntil?.toISOString() ?? null,
    endedReason: row.endedReason,
    version: row.version,
    serverNow: now.toISOString(),
    remainingMs,
    broadcaster: row.broadcaster,
  };
}

const sessionInclude = {
  broadcaster: {
    select: {
      id: true,
      username: true,
      slug: true,
      name: true,
      photo: true,
    },
  },
} as const;

export async function getLiveSessionById(id: string) {
  return prisma.liveSession.findUnique({
    where: { id },
    include: sessionInclude,
  });
}

/**
 * Create a PREPARING session, provision Cloudflare Live Input, return WHIP
 * credentials to the broadcaster only. Does not start the 30-minute clock yet.
 */
export async function prepareLiveSession(opts: {
  user: SessionUser;
  title: string;
  locationLabel: string;
  now?: Date;
}) {
  const now = opts.now ?? new Date();
  if (!isLiveStreamingAvailable()) {
    httpError("Source Bridge Live is not available", 503, "FEATURE_UNAVAILABLE");
  }
  const el = await evaluateLiveEligibility(opts.user, now);
  if (!el.allowed) throwEligibilityHttp(el);

  const title = normalizeTitle(opts.title);
  const locationLabel = normalizeLocation(opts.locationLabel);
  const provider = getLiveVideoProvider();

  try {
    const session = await prisma.$transaction(async (tx) => {
      const created = await tx.liveSession.create({
        data: {
          broadcasterId: opts.user.id,
          status: "PREPARING",
          title,
          locationLabel,
          provider: LIVE_PROVIDER_CLOUDFLARE,
          activeLock: opts.user.id,
          version: 1,
        },
        include: sessionInclude,
      });
      return created;
    });

    try {
      const input = await provider.createLiveInput({
        name: `${title} (${session.id})`,
        sessionId: session.id,
      });
      const creds = await provider.getPublishCredentials(input.inputId);
      const updated = await prisma.liveSession.update({
        where: { id: session.id },
        data: {
          providerInputId: input.inputId,
          providerVideoId: input.videoId || "",
          version: { increment: 1 },
        },
        include: sessionInclude,
      });
      return {
        session: toLiveSessionPublic(updated, now),
        publish: creds,
      };
    } catch (err) {
      await failPreparing(session.id, "FAILED", now);
      throw err;
    }
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") {
      httpError("You already have a Live in progress", 409, "ACTIVE_LIVE");
    }
    throw err;
  }
}

export async function goLiveSession(opts: {
  user: SessionUser;
  sessionId: string;
  now?: Date;
}) {
  const now = opts.now ?? new Date();
  const row = await prisma.liveSession.findUnique({
    where: { id: opts.sessionId },
    include: sessionInclude,
  });
  if (!row) httpError("Live not found", 404);
  if (row.broadcasterId !== opts.user.id) httpError("Forbidden", 403);
  if (row.status === "LIVE") return toLiveSessionPublic(row, now);
  if (row.status !== "PREPARING") {
    httpError("This Live cannot start", 409, "INVALID_STATE");
  }
  if (now.getTime() - row.createdAt.getTime() > LIVE_PREPARING_TTL_MS) {
    await failPreparing(row.id, "ABANDONED", now);
    httpError("Go Live timed out — try again", 408, "PREPARING_EXPIRED");
  }

  const startedAt = now;
  const endsAt = liveEndsAt(startedAt);
  const updated = await prisma.liveSession.update({
    where: { id: row.id, status: "PREPARING" },
    data: {
      status: "LIVE",
      startedAt,
      endsAt,
      version: { increment: 1 },
    },
    include: sessionInclude,
  });
  return toLiveSessionPublic(updated, now);
}

export async function getBroadcasterPublishCredentials(opts: {
  user: SessionUser;
  sessionId: string;
}) {
  const row = await prisma.liveSession.findUnique({
    where: { id: opts.sessionId },
  });
  if (!row) httpError("Live not found", 404);
  if (row.broadcasterId !== opts.user.id) httpError("Forbidden", 403);
  if (row.status !== "PREPARING" && row.status !== "LIVE") {
    httpError("Publish credentials are no longer available", 409);
  }
  if (!row.providerInputId) httpError("Live ingest is not ready", 409);
  return getLiveVideoProvider().getPublishCredentials(row.providerInputId);
}

type EndOpts = {
  sessionId: string;
  reason: LiveEndedReason;
  actorUserId?: string;
  admin?: boolean;
  now?: Date;
};

export async function endLiveSession(opts: EndOpts) {
  const now = opts.now ?? new Date();
  const row = await prisma.liveSession.findUnique({
    where: { id: opts.sessionId },
    include: sessionInclude,
  });
  if (!row) httpError("Live not found", 404);

  if (opts.admin) {
    if (row.status !== "PREPARING" && row.status !== "LIVE") {
      return toLiveSessionPublic(row, now);
    }
  } else {
    if (opts.actorUserId && row.broadcasterId !== opts.actorUserId) {
      httpError("Forbidden", 403);
    }
    if (row.status !== "PREPARING" && row.status !== "LIVE") {
      return toLiveSessionPublic(row, now);
    }
  }

  const status =
    opts.reason === "ADMIN"
      ? "TERMINATED"
      : row.status === "LIVE" && opts.reason !== "FAILED"
        ? "ENDED"
        : "FAILED";
  const wasLive = row.status === "LIVE" && status === "ENDED";
  const cooldownUntil =
    row.status === "LIVE" || opts.reason === "ADMIN"
      ? liveCooldownUntil(now)
      : null;
  const wasLiveUntil = wasLive ? liveWasLiveUntil(now) : null;

  const updated = await prisma.liveSession.update({
    where: { id: row.id },
    data: {
      status,
      endedAt: now,
      endedReason: opts.reason,
      cooldownUntil,
      wasLiveUntil,
      activeLock: null,
      recordingCleanupStatus: row.providerInputId ? "PENDING" : "SKIPPED",
      version: { increment: 1 },
    },
    include: sessionInclude,
  });

  void cleanupLiveProvider(updated.id).catch((err) => {
    console.error("[live:cleanup]", updated.id, err);
  });

  return toLiveSessionPublic(updated, now);
}

export async function expireLiveIfNeeded(
  sessionId: string,
  now: Date = new Date(),
) {
  const row = await prisma.liveSession.findUnique({ where: { id: sessionId } });
  if (!row) return null;
  if (row.status === "LIVE" && isLiveExpired(row.endsAt, now)) {
    await endLiveSession({
      sessionId: row.id,
      reason: "EXPIRED",
      now,
    });
    return prisma.liveSession.findUnique({ where: { id: sessionId } });
  }
  if (
    row.status === "PREPARING" &&
    now.getTime() - row.createdAt.getTime() > LIVE_PREPARING_TTL_MS
  ) {
    await failPreparing(row.id, "ABANDONED", now);
    return prisma.liveSession.findUnique({ where: { id: sessionId } });
  }
  return row;
}

async function failPreparing(
  sessionId: string,
  reason: LiveEndedReason,
  now: Date,
) {
  const row = await prisma.liveSession.updateMany({
    where: { id: sessionId, status: "PREPARING" },
    data: {
      status: "FAILED",
      endedAt: now,
      endedReason: reason,
      activeLock: null,
      recordingCleanupStatus: "PENDING",
      version: { increment: 1 },
    },
  });
  if (row.count > 0) {
    void cleanupLiveProvider(sessionId).catch((err) => {
      console.error("[live:cleanup]", sessionId, err);
    });
  }
}

export async function cleanupLiveProvider(sessionId: string) {
  const row = await prisma.liveSession.findUnique({ where: { id: sessionId } });
  if (!row) return;
  if (row.recordingCleanupStatus === "DONE") return;
  const provider = getLiveVideoProvider();
  try {
    if (row.providerInputId) {
      try {
        await provider.disableLiveInput(row.providerInputId);
      } catch {
        /* continue */
      }
      const current = await provider.getCurrentVideo(row.providerInputId).catch(
        () => null,
      );
      const videoId = row.providerVideoId || current?.videoId;
      if (videoId) {
        await provider.deleteRecording(videoId);
      }
      await provider.deleteLiveInput(row.providerInputId);
    }
    await prisma.liveSession.update({
      where: { id: sessionId },
      data: {
        recordingCleanupStatus: "DONE",
        recordingDeletedAt: new Date(),
        recordingCleanupError: "",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "cleanup failed";
    await prisma.liveSession.update({
      where: { id: sessionId },
      data: {
        recordingCleanupStatus: "FAILED",
        recordingCleanupAttempts: { increment: 1 },
        recordingCleanupError: message.slice(0, 500),
      },
    });
  }
}

export async function maybeStoreVideoId(sessionId: string) {
  const row = await prisma.liveSession.findUnique({ where: { id: sessionId } });
  if (!row?.providerInputId || row.providerVideoId) return row;
  const current = await getLiveVideoProvider()
    .getCurrentVideo(row.providerInputId)
    .catch(() => null);
  if (!current?.videoId) return row;
  return prisma.liveSession.update({
    where: { id: sessionId },
    data: { providerVideoId: current.videoId },
  });
}
