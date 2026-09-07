"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Realtime,
  RealtimeChannel,
  TokenRequest,
} from "ably";
import type { LiveCommentPublic } from "@/lib/live/realtime/types";
import {
  LIVE_COMMENT_EVENT,
  LIVE_COMMENT_UI_STACK,
  LIVE_ENGAGEMENT_UNAVAILABLE_MESSAGE,
} from "@/lib/live/realtime/constants";
import { loadAblyBrowser } from "./loadAblyBrowser";

type RealtimeRole = "viewer" | "broadcaster";

type TokenGrant = {
  ok: boolean;
  role: RealtimeRole;
  channel: string;
  liveSessionId: string;
  tokenRequest: TokenRequest;
};

export type LiveRealtimeState = {
  available: boolean;
  connected: boolean;
  viewerCount: number;
  comments: LiveCommentPublic[];
  role: RealtimeRole | null;
  error: string | null;
};

type Options = {
  liveSessionId: string;
  /** When false, disconnect and leave presence. */
  active: boolean;
  /**
   * Viewers enter presence only after playback has genuinely started at least once.
   * Temporary WHEP recovery must keep this true so presence is not dropped.
   */
  allowPresence: boolean;
  /** Suppress public comment UI (e.g. Capture Item sheet) — do not leave Ably. */
  suppressCommentsUi?: boolean;
};

function mergeComment(
  list: LiveCommentPublic[],
  next: LiveCommentPublic,
): LiveCommentPublic[] {
  if (list.some((c) => c.id === next.id)) return list;
  const merged = [...list, next].sort((a, b) => {
    const ta = Date.parse(a.createdAt);
    const tb = Date.parse(b.createdAt);
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
  return merged.slice(-Math.max(LIVE_COMMENT_UI_STACK * 3, 40));
}

/**
 * Dedicated Live realtime boundary — Ably connect / presence / comment subscribe.
 * Does not touch WHEP/WHIP PeerConnections.
 */
export function useLiveRealtime(opts: Options): LiveRealtimeState & {
  postComment: (
    body: string,
    clientMessageId: string,
  ) => Promise<{ ok: true; comment: LiveCommentPublic } | { ok: false; error: string }>;
} {
  const [available, setAvailable] = useState(false);
  const [connected, setConnected] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [comments, setComments] = useState<LiveCommentPublic[]>([]);
  const [role, setRole] = useState<RealtimeRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<Realtime | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const presenceEnteredRef = useRef(false);
  const everPlayedRef = useRef(false);
  const sessionIdRef = useRef(opts.liveSessionId);
  sessionIdRef.current = opts.liveSessionId;

  if (opts.allowPresence) everPlayedRef.current = true;

  const syncPresenceCount = useCallback(async (channel: RealtimeChannel) => {
    try {
      const members = await channel.presence.get();
      // Ably dedupes by clientId — each unique authenticated viewer is one member.
      setViewerCount(members.length);
    } catch {
      /* keep last known count */
    }
  }, []);

  useEffect(() => {
    if (!opts.active) {
      presenceEnteredRef.current = false;
      everPlayedRef.current = false;
      const ch = channelRef.current;
      const client = clientRef.current;
      channelRef.current = null;
      clientRef.current = null;
      if (ch) {
        void ch.presence.leave().catch(() => {});
        ch.unsubscribe();
        ch.presence.unsubscribe();
      }
      if (client) client.close();
      setConnected(false);
      setAvailable(false);
      setViewerCount(0);
      setComments([]);
      setRole(null);
      return;
    }

    let cancelled = false;
    const sessionId = opts.liveSessionId;

    async function boot() {
      try {
        const histRes = await fetch(
          `/api/live/sessions/${sessionId}/comments`,
          { cache: "no-store" },
        );
        if (histRes.ok) {
          const hist = (await histRes.json()) as {
            comments?: LiveCommentPublic[];
          };
          if (!cancelled && hist.comments) {
            setComments(hist.comments);
          }
        }

        const tokenRes = await fetch(
          `/api/live/sessions/${sessionId}/realtime-token`,
          { method: "POST" },
        );
        if (!tokenRes.ok) {
          const data = (await tokenRes.json().catch(() => ({}))) as {
            error?: string;
            code?: string;
          };
          if (!cancelled) {
            setAvailable(false);
            setError(
              data.code === "ABLY_UNAVAILABLE" || tokenRes.status === 503
                ? LIVE_ENGAGEMENT_UNAVAILABLE_MESSAGE
                : data.error || LIVE_ENGAGEMENT_UNAVAILABLE_MESSAGE,
            );
          }
          return;
        }
        const grant = (await tokenRes.json()) as TokenGrant;
        if (cancelled) return;
        setRole(grant.role);
        setAvailable(true);
        setError(null);

        const Ably = await loadAblyBrowser();
        if (cancelled) return;

        let seedToken: TokenRequest | null = grant.tokenRequest;
        const client = new Ably.Realtime({
          authCallback: (
            _tokenParams: unknown,
            callback: (
              err: string | null,
              tokenRequestOrDetails: TokenRequest | null,
            ) => void,
          ) => {
            void (async () => {
              try {
                if (seedToken) {
                  const seeded = seedToken;
                  seedToken = null;
                  callback(null, seeded);
                  return;
                }
                const res = await fetch(
                  `/api/live/sessions/${sessionIdRef.current}/realtime-token`,
                  { method: "POST" },
                );
                if (!res.ok) {
                  callback(LIVE_ENGAGEMENT_UNAVAILABLE_MESSAGE, null);
                  return;
                }
                const next = (await res.json()) as TokenGrant;
                callback(null, next.tokenRequest);
              } catch {
                callback(LIVE_ENGAGEMENT_UNAVAILABLE_MESSAGE, null);
              }
            })();
          },
          closeOnUnload: true,
        });
        clientRef.current = client;

        client.connection.on("connected", () => {
          if (!cancelled) setConnected(true);
        });
        client.connection.on("failed", () => {
          if (!cancelled) {
            setConnected(false);
            setAvailable(false);
            setError(LIVE_ENGAGEMENT_UNAVAILABLE_MESSAGE);
          }
        });

        const channel = client.channels.get(grant.channel);
        channelRef.current = channel;

        channel.subscribe(LIVE_COMMENT_EVENT, (msg) => {
          const data = msg.data as LiveCommentPublic | undefined;
          if (!data?.id || !data.body) return;
          setComments((prev) => mergeComment(prev, data));
        });

        channel.presence.subscribe(() => {
          void syncPresenceCount(channel);
        });
        await syncPresenceCount(channel);

        if (
          grant.role === "viewer" &&
          (opts.allowPresence || everPlayedRef.current) &&
          !presenceEnteredRef.current
        ) {
          await channel.presence.enter({ v: 1 });
          presenceEnteredRef.current = true;
          await syncPresenceCount(channel);
        }
      } catch {
        if (!cancelled) {
          setAvailable(false);
          setError(LIVE_ENGAGEMENT_UNAVAILABLE_MESSAGE);
        }
      }
    }

    void boot();

    return () => {
      cancelled = true;
      presenceEnteredRef.current = false;
      const ch = channelRef.current;
      const client = clientRef.current;
      channelRef.current = null;
      clientRef.current = null;
      if (ch) {
        void ch.presence.leave().catch(() => {});
        ch.unsubscribe();
        ch.presence.unsubscribe();
      }
      if (client) client.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.active, opts.liveSessionId]);

  useEffect(() => {
    if (!opts.active || !opts.allowPresence) return;
    everPlayedRef.current = true;
    const channel = channelRef.current;
    const client = clientRef.current;
    if (!channel || !client || role !== "viewer") return;
    if (presenceEnteredRef.current) return;
    if (client.connection.state !== "connected") return;
    void (async () => {
      try {
        await channel.presence.enter({ v: 1 });
        presenceEnteredRef.current = true;
        await syncPresenceCount(channel);
      } catch {
        /* soft-fail — watching continues */
      }
    })();
  }, [opts.active, opts.allowPresence, role, syncPresenceCount]);

  const postComment = useCallback(
    async (body: string, clientMessageId: string) => {
      try {
        const res = await fetch(
          `/api/live/sessions/${opts.liveSessionId}/comments`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body, clientMessageId }),
          },
        );
        const data = (await res.json().catch(() => ({}))) as {
          comment?: LiveCommentPublic;
          error?: string;
        };
        if (!res.ok || !data.comment) {
          return {
            ok: false as const,
            error: data.error || LIVE_ENGAGEMENT_UNAVAILABLE_MESSAGE,
          };
        }
        setComments((prev) => mergeComment(prev, data.comment!));
        return { ok: true as const, comment: data.comment };
      } catch {
        return {
          ok: false as const,
          error: LIVE_ENGAGEMENT_UNAVAILABLE_MESSAGE,
        };
      }
    },
    [opts.liveSessionId],
  );

  return {
    available,
    connected,
    viewerCount,
    comments: comments.slice(-LIVE_COMMENT_UI_STACK),
    role,
    error: opts.suppressCommentsUi ? null : error,
    postComment,
  };
}
