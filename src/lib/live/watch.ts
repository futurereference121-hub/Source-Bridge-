import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { isAdminUser } from "@/lib/auth";
import { viewerTokenExpUnix } from "./clock";
import { LIVE_WATCH_UNAVAILABLE_MESSAGE } from "./constants";
import { expireLiveIfNeeded, maybeStoreVideoId } from "./sessions";
import { getLiveVideoProvider } from "./get-provider";
import { STREAM_SIGNING_KEY_INVALID } from "./signing-key";

function httpError(message: string, status: number, code?: string): never {
  const err = new Error(message) as Error & { status: number; code?: string };
  err.status = status;
  if (code) err.code = code;
  throw err;
}

/**
 * Authenticated watch grant. Video URLs point at Cloudflare Stream — never proxied.
 * Tokens are capped at session endsAt.
 */
export async function issueLiveWatchGrant(opts: {
  user: SessionUser;
  sessionId: string;
  now?: Date;
}) {
  if (!opts.user) {
    const err = new Error("Sign in required") as Error & { status: number; code: string };
    err.status = 401;
    err.code = "UNAUTHENTICATED";
    throw err;
  }
  const now = opts.now ?? new Date();
  const row = await expireLiveIfNeeded(opts.sessionId, now);
  if (!row) httpError("Live not found", 404);
  if (row.status !== "LIVE") {
    httpError("This Live has ended", 409, "NOT_LIVE");
  }
  if (!row.endsAt || now.getTime() >= row.endsAt.getTime()) {
    httpError("This Live has ended", 409, "NOT_LIVE");
  }
  if (isAdminUser(opts.user) && row.broadcasterId !== opts.user.id) {
    // adminsource watches via admin tools; ordinary watch is members only.
  }

  const fresh = (await maybeStoreVideoId(row.id)) || row;
  const expUnix = viewerTokenExpUnix(now, fresh.endsAt!);
  const nbfUnix = Math.floor(now.getTime() / 1000) - 5;
  const provider = getLiveVideoProvider();
  let playback;
  try {
    playback = await provider.createViewerToken({
      inputId: fresh.providerInputId,
      videoId: fresh.providerVideoId || null,
      expUnix,
      nbfUnix,
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === STREAM_SIGNING_KEY_INVALID) {
      console.error("[live:watch:signing]", STREAM_SIGNING_KEY_INVALID);
      httpError(LIVE_WATCH_UNAVAILABLE_MESSAGE, 503, STREAM_SIGNING_KEY_INVALID);
    }
    throw err;
  }

  return {
    playback: {
      hlsUrl: playback.hlsUrl,
      whepUrl: playback.whepUrl,
      thumbnailUrl: playback.thumbnailUrl,
      tokenExp: playback.exp,
    },
    providerVideoId: fresh.providerVideoId || null,
    endsAt: fresh.endsAt!.toISOString(),
    serverNow: now.toISOString(),
  };
}

export async function issueCaptureThumbnailGrant(opts: {
  user: SessionUser;
  sessionId: string;
  offsetSeconds: number;
  now?: Date;
}) {
  const grant = await issueLiveWatchGrant(opts);
  const row = await prisma.liveSession.findUnique({
    where: { id: opts.sessionId },
  });
  if (!row?.providerInputId) httpError("Live ingest is not ready", 409);
  const provider = getLiveVideoProvider();
  const token = grant.playback.hlsUrl.split(".cloudflarestream.com/")[1]?.split("/")[0];
  if (!token) httpError("Could not sign a Live frame", 503, "NO_FRAME_TOKEN");
  const url = provider.getLiveFrameThumbnailUrl({
    inputId: row.providerInputId,
    videoId: row.providerVideoId || null,
    offsetSeconds: opts.offsetSeconds,
    token,
  });
  return { thumbnailUrl: url, serverNow: grant.serverNow, endsAt: grant.endsAt };
}
