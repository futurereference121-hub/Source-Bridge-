"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LIVE_CAPTURE_DRAFT_KEY,
  LIVE_REPORT_REASONS,
  LIVE_WATCH_UNAVAILABLE_MESSAGE,
} from "@/lib/live/constants";
import {
  tokenRefreshDelayMs,
  WHEP_AUTOPLAY_MESSAGE,
  WHEP_FAILED_MESSAGE,
  WHEP_RECONNECT_MESSAGE,
} from "@/lib/live/whep-viewer-policy";
import {
  isCaptureAllowed,
  type WhepViewerState,
} from "@/lib/live/whep-viewer-state";
import { useAppUi } from "@/components/providers/AppProviders";
import { LiveBadge, LiveTimer } from "@/components/live/LiveBadge";
import {
  WhepViewerSession,
  type WatchGrantLike,
} from "@/components/live/whep-viewer-session";
import type { LiveSessionPublic } from "@/lib/live/public-types";

type WatchGrant = WatchGrantLike & {
  playback: {
    hlsUrl: string;
    whepUrl: string | null;
    thumbnailUrl: string;
    tokenExp: number;
  };
};

type Props = {
  session: LiveSessionPublic;
  isBroadcaster: boolean;
};

async function canvasFrame(video: HTMLVideoElement): Promise<Blob | null> {
  try {
    const w = video.videoWidth || 720;
    const h = video.videoHeight || 1280;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    return await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.9),
    );
  } catch {
    return null;
  }
}

export function LivePlayer({ session, isBroadcaster }: Props) {
  const router = useRouter();
  const { account, requireAuth, showToast } = useAppUi();
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<WhepViewerSession | null>(null);
  const grantRef = useRef<WatchGrant | null>(null);
  const endedRef = useRef(session.status !== "LIVE");
  const [grant, setGrant] = useState<WatchGrant | null>(null);
  const [remainingMs, setRemainingMs] = useState(session.remainingMs);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureUrl, setCaptureUrl] = useState<string | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [ended, setEnded] = useState(session.status !== "LIVE");
  const [viewer, setViewer] = useState<WhepViewerState | null>(null);

  async function loadGrant(): Promise<WatchGrant | null> {
    const res = await fetch(`/api/live/sessions/${session.id}/watch`, {
      method: "POST",
    });
    if (res.status === 401) {
      requireAuth("watch Live", `/live/${session.id}`);
      return null;
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
      };
      if (data.code === "NOT_LIVE") {
        endedRef.current = true;
        setEnded(true);
        sessionRef.current?.markEnded();
      }
      throw new Error(data.error || LIVE_WATCH_UNAVAILABLE_MESSAGE);
    }
    const next = (await res.json()) as WatchGrant;
    grantRef.current = next;
    return next;
  }

  useEffect(() => {
    endedRef.current = ended;
    if (ended) sessionRef.current?.markEnded();
  }, [ended]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    let cancelled = false;

    const whep = new WhepViewerSession(el, {
      fetchGrant: async () => {
        if (endedRef.current) return null;
        try {
          const next = await loadGrant();
          if (next) {
            setGrant(next);
            whep.setGrant(next);
          }
          return next;
        } catch {
          if (!endedRef.current) showToast(LIVE_WATCH_UNAVAILABLE_MESSAGE);
          const cached = grantRef.current;
          if (cached && cached.playback.tokenExp * 1000 > Date.now() + 2_000) {
            return cached;
          }
          return null;
        }
      },
      onState: (state) => {
        if (!cancelled) setViewer({ ...state });
      },
      onDiag: (event, detail) => {
        // Privacy-safe: event names + coarse numbers only. Never tokens/SDP.
        if (process.env.NODE_ENV !== "production") {
          console.info("[live:whep]", event, detail || {});
        }
      },
    });
    sessionRef.current = whep;

    void (async () => {
      try {
        const next = await loadGrant();
        if (cancelled || !next) return;
        setGrant(next);
        await whep.start(next);
      } catch {
        if (!cancelled) showToast(LIVE_WATCH_UNAVAILABLE_MESSAGE);
      }
    })();

    return () => {
      cancelled = true;
      whep.dispose();
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void fetch(`/api/live/sessions/${session.id}`, { cache: "no-store" })
        .then(async (res) => {
          const data = (await res.json()) as { session?: LiveSessionPublic };
          if (data.session?.status !== "LIVE") {
            endedRef.current = true;
            setEnded(true);
            sessionRef.current?.markEnded();
          }
        })
        .catch(() => {});
    }, 5000);
    return () => window.clearInterval(id);
  }, [session.id]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const ends = Date.parse(session.endsAt || grant?.endsAt || "") || 0;
      const left = Math.max(0, ends - Date.now());
      setRemainingMs(left);
      if (left <= 0 && session.status === "LIVE") {
        endedRef.current = true;
        setEnded(true);
        sessionRef.current?.markEnded();
        const v = videoRef.current;
        if (v) v.pause();
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [session.endsAt, session.status, grant?.endsAt]);

  // Soft token refresh: update grant for the *next* rebuild only.
  // Do NOT destroy a healthy WHEP PeerConnection on token rollover.
  useEffect(() => {
    if (!grant || ended) return;
    const delay = tokenRefreshDelayMs(grant.playback.tokenExp, Date.now());
    const t = window.setTimeout(() => {
      void loadGrant()
        .then((next) => {
          if (!next || endedRef.current) return;
          setGrant(next);
          sessionRef.current?.setGrant(next);
        })
        .catch(() => {});
    }, delay);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grant?.playback.tokenExp, ended]);

  async function captureItem() {
    if (!account) {
      requireAuth("capture an item", `/live/${session.id}`);
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    if (!isCaptureAllowed(viewer || sessionRef.current?.getState() || {
      phase: "idle",
      generation: 0,
      retryCount: 0,
      hasVideoTrack: false,
      hasAudioTrack: false,
      lastReason: null,
      captureAvailable: false,
      showReconnectingUi: false,
    })) {
      showToast("Picture not available while reconnecting");
      return;
    }
    setCaptureBusy(true);
    try {
      const blob = await canvasFrame(v);
      if (!blob || v.videoWidth <= 0) {
        showToast("Picture not available");
        return;
      }
      const file = new File([blob], "live-capture.jpg", { type: "image/jpeg" });
      const form = new FormData();
      form.set("file", file);
      form.set("folder", "live");
      const up = await fetch("/api/upload", { method: "POST", body: form });
      if (!up.ok) {
        showToast("Could not save capture");
        return;
      }
      const data = (await up.json()) as { url?: string };
      if (!data.url) {
        showToast("Could not save capture");
        return;
      }
      setCaptureUrl(data.url);
      setCaptureOpen(true);
    } finally {
      setCaptureBusy(false);
    }
  }

  async function messageSourcer() {
    if (!captureUrl) return;
    const v = videoRef.current;
    const res = await fetch(`/api/live/sessions/${session.id}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageUrl: captureUrl,
        viewedOffsetSeconds: Math.floor(v?.currentTime || 0),
      }),
    });
    if (!res.ok) {
      showToast("Could not open conversation");
      return;
    }
    const data = (await res.json()) as {
      conversationId: string;
      suggestedText: string;
      imageUrl: string;
      autoSent?: boolean;
    };
    sessionStorage.setItem(
      LIVE_CAPTURE_DRAFT_KEY,
      JSON.stringify({
        conversationId: data.conversationId,
        text: data.suggestedText,
        imageUrl: data.imageUrl,
      }),
    );
    setCaptureOpen(false);
    router.push(`/inbox/${data.conversationId}`);
  }

  async function submitReport(reason: string) {
    const res = await fetch(`/api/live/sessions/${session.id}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    setReportOpen(false);
    showToast(res.ok ? "Report sent" : "Could not send report");
  }

  async function endLive() {
    const res = await fetch(`/api/live/sessions/${session.id}/end`, {
      method: "POST",
    });
    if (!res.ok) {
      showToast("Could not end Live");
      return;
    }
    endedRef.current = true;
    setEnded(true);
    sessionRef.current?.markEnded();
    showToast("Live ended");
  }

  if (ended || session.status !== "LIVE") {
    return (
      <div className="flex aspect-[9/16] w-full flex-col items-center justify-center rounded-2xl bg-navy-mid text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
          Was Live
        </p>
        <p className="mt-2 text-sm text-white/70">Replay is not available.</p>
      </div>
    );
  }

  const phase = viewer?.phase;
  const showReconnecting =
    Boolean(viewer?.showReconnectingUi) &&
    phase !== "failed" &&
    phase !== "autoplay_blocked" &&
    phase !== "ended";
  const showFailed = phase === "failed";
  const showAutoplay = phase === "autoplay_blocked";
  const captureEnabled =
    !captureBusy &&
    isCaptureAllowed(
      viewer || {
        phase: "idle",
        generation: 0,
        retryCount: 0,
        hasVideoTrack: false,
        hasAudioTrack: false,
        lastReason: null,
        captureAvailable: false,
        showReconnectingUi: false,
      },
    );

  return (
    <div className="relative overflow-hidden rounded-2xl bg-black">
      <video
        ref={videoRef}
        className="aspect-[9/16] w-full object-cover"
        playsInline
        autoPlay
        muted={isBroadcaster}
      />
      {showReconnecting ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-white">
            {WHEP_RECONNECT_MESSAGE}
          </p>
        </div>
      ) : null}
      {showAutoplay ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55">
          <button
            type="button"
            onClick={() => void sessionRef.current?.userGesturePlay()}
            className="rounded-lg bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-navy"
          >
            {WHEP_AUTOPLAY_MESSAGE}
          </button>
        </div>
      ) : null}
      {showFailed ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 px-6 text-center">
          <p className="text-sm text-white/85">{WHEP_FAILED_MESSAGE}</p>
          <button
            type="button"
            onClick={() => void sessionRef.current?.manualRetry()}
            className="rounded-lg bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-navy"
          >
            Retry
          </button>
        </div>
      ) : null}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between bg-gradient-to-b from-black/70 to-transparent p-4">
        <div>
          <LiveBadge />
          <p className="mt-2 text-sm font-medium text-white">{session.title}</p>
          <p className="text-xs text-white/60">{session.locationLabel}</p>
        </div>
        <LiveTimer remainingMs={remainingMs} />
      </div>

      <div className="absolute inset-x-0 bottom-0 space-y-3 bg-gradient-to-t from-black/80 to-transparent p-4">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void captureItem()}
            disabled={!captureEnabled}
            className="rounded-lg bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-navy disabled:cursor-not-allowed disabled:opacity-40"
          >
            {captureBusy ? "Capturing…" : "Capture Item"}
          </button>
          {isBroadcaster ? (
            <button
              type="button"
              onClick={() => void endLive()}
              className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white"
            >
              End Live
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              className="rounded-lg border border-white/25 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white"
            >
              Report Live
            </button>
          )}
        </div>
      </div>

      {captureOpen && captureUrl ? (
        <div className="absolute inset-0 z-10 flex items-end bg-black/70 p-4 sm:items-center sm:justify-center">
          <div className="w-full max-w-sm rounded-2xl bg-navy-mid p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/50">
              Capture Item
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={captureUrl}
              alt="Captured frame"
              className="mt-3 max-h-64 w-full rounded-xl object-contain"
            />
            <p className="mt-3 text-sm text-white/70">
              Message opens your existing chat. Nothing is sent until you tap send.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => void messageSourcer()}
                className="rounded-lg bg-electric px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white"
              >
                Message Sourcer
              </button>
              <button
                type="button"
                onClick={() => setCaptureOpen(false)}
                className="rounded-lg px-3 py-2 text-xs text-white/60"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reportOpen ? (
        <div className="absolute inset-0 z-10 flex items-end bg-black/70 p-4 sm:items-center sm:justify-center">
          <div className="w-full max-w-sm rounded-2xl bg-navy-mid p-4">
            <p className="text-sm font-medium text-white">Report this Live</p>
            <ul className="mt-3 space-y-1">
              {LIVE_REPORT_REASONS.map((reason) => (
                <li key={reason}>
                  <button
                    type="button"
                    className="w-full rounded-lg px-3 py-2 text-left text-sm text-white/80 hover:bg-white/5"
                    onClick={() => void submitReport(reason)}
                  >
                    {reason}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="mt-2 text-xs text-white/45"
              onClick={() => setReportOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
