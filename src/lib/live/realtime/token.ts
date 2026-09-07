import type { SessionUser } from "@/lib/auth";
import { expireLiveIfNeeded } from "@/lib/live/sessions";
import { isAblyConfigured } from "./config";
import {
  createLiveSessionTokenRequest,
  type LiveRealtimeRole,
} from "./ably-server";
import { liveRealtimeChannelName } from "./channel";
import { LIVE_ENGAGEMENT_UNAVAILABLE_MESSAGE } from "./constants";

function httpError(message: string, status: number, code?: string): never {
  const err = new Error(message) as Error & { status: number; code?: string };
  err.status = status;
  if (code) err.code = code;
  throw err;
}

/**
 * Authenticated Ably token for one LIVE session the user may watch/broadcast.
 * Does not expose ABLY_API_KEY. Capabilities are session-scoped only.
 */
export async function issueLiveRealtimeToken(opts: {
  user: SessionUser;
  sessionId: string;
  now?: Date;
}) {
  if (!opts.user) {
    httpError("Sign in required", 401, "UNAUTHENTICATED");
  }
  if (!isAblyConfigured()) {
    httpError(LIVE_ENGAGEMENT_UNAVAILABLE_MESSAGE, 503, "ABLY_UNAVAILABLE");
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

  const role: LiveRealtimeRole =
    row.broadcasterId === opts.user.id ? "broadcaster" : "viewer";

  const tokenRequest = await createLiveSessionTokenRequest({
    userId: opts.user.id,
    liveSessionId: row.id,
    role,
  });

  return {
    ok: true as const,
    role,
    channel: liveRealtimeChannelName(row.id),
    liveSessionId: row.id,
    tokenRequest,
    serverNow: now.toISOString(),
    endsAt: row.endsAt!.toISOString(),
  };
}
