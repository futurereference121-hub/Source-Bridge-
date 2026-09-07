import Ably from "ably";
import { getAblyApiKey, isAblyConfigured } from "./config";
import { liveRealtimeChannelName } from "./channel";
import {
  LIVE_COMMENT_EVENT,
  LIVE_REALTIME_TOKEN_TTL_MS,
} from "./constants";
import {
  liveBroadcasterClientId,
  liveViewerClientId,
} from "./identity";

let restClient: Ably.Rest | null = null;

function httpError(message: string, status: number, code?: string): never {
  const err = new Error(message) as Error & { status: number; code?: string };
  err.status = status;
  if (code) err.code = code;
  throw err;
}

/** Server-only Ably REST client. Never instantiate in browser bundles. */
export function getAblyRest(): Ably.Rest {
  const key = getAblyApiKey();
  if (!key) {
    httpError("Live engagement is temporarily unavailable", 503, "ABLY_UNAVAILABLE");
  }
  if (!restClient) {
    restClient = new Ably.Rest({ key });
  }
  return restClient;
}

export type LiveRealtimeRole = "viewer" | "broadcaster";

/**
 * Issue a short-lived Ably TokenRequest scoped to one LiveSession channel.
 * Viewers: subscribe + presence (enter). Broadcasters: subscribe only (no presence enter).
 * Never grants publish — canonical comments are server-published.
 */
export async function createLiveSessionTokenRequest(opts: {
  userId: string;
  liveSessionId: string;
  role: LiveRealtimeRole;
  ttlMs?: number;
}): Promise<Ably.TokenRequest> {
  if (!isAblyConfigured()) {
    httpError("Live engagement is temporarily unavailable", 503, "ABLY_UNAVAILABLE");
  }
  const channel = liveRealtimeChannelName(opts.liveSessionId);
  const clientId =
    opts.role === "broadcaster"
      ? liveBroadcasterClientId(opts.userId)
      : liveViewerClientId(opts.userId);
  const ops =
    opts.role === "broadcaster"
      ? (["subscribe"] as const)
      : (["subscribe", "presence"] as const);

  const rest = getAblyRest();
  return rest.auth.createTokenRequest({
    clientId,
    ttl: opts.ttlMs ?? LIVE_REALTIME_TOKEN_TTL_MS,
    capability: {
      [channel]: [...ops],
    },
  });
}

/** Server publishes a canonical comment after DB persistence. */
export async function publishLiveCommentEvent(opts: {
  liveSessionId: string;
  comment: {
    id: string;
    body: string;
    createdAt: string;
    commenter: {
      id: string;
      username: string | null;
      name: string;
      photo: string;
    };
  };
}): Promise<void> {
  if (!isAblyConfigured()) return;
  try {
    const rest = getAblyRest();
    const channel = rest.channels.get(
      liveRealtimeChannelName(opts.liveSessionId),
    );
    await channel.publish(LIVE_COMMENT_EVENT, opts.comment);
  } catch (err) {
    // Do not fail the HTTP write path if fanout flakes — comment is already in DB.
    console.error("[live:realtime:publish]", (err as Error)?.name || "publish_failed");
  }
}
