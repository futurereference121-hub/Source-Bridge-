"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  LIVE_CAPTURE_RECONNECTING_MESSAGE,
  LIVE_CAPTURE_SUGGESTED_TEXT,
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
  isPlaybackHealthy,
  type WhepViewerState,
} from "@/lib/live/whep-viewer-state";
import { useAppUi } from "@/components/providers/AppProviders";
import { LiveBadge, LiveTimer } from "@/components/live/LiveBadge";
import {
  WhepViewerSession,
  type WatchGrantLike,
} from "@/components/live/whep-viewer-session";
import type { LiveSessionPublic } from "@/lib/live/public-types";
import { LiveEngagementOverlay } from "@/components/live/realtime/LiveEngagementOverlay";

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

type CaptureDraft = {
  imageUrl: string;
  conversationId: string;
  text: string;
  sourcerLabel: string;
};

async function canvasFrame(video: HTMLVideoElement): Promise<Blob | null> {
  try {
    const w = video.videoWidth || 720;
    const h = video.videoHeight || 1280;
    if (w <= 0 || h <= 0) return null;
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

function fallbackSuggestedText(title: string) {
  return `${LIVE_CAPTURE_SUGGESTED_TEXT} (${title})`;
}

function idleViewerState(): WhepViewerState {
  return {
    phase: "idle",
    generation: 0,
    retryCount: 0,
    hasVideoTrack: false,
    hasAudioTrack: false,
    lastReason: null,
    captureAvailable: false,
    showReconnectingUi: false,
  };
}

export function LivePlayer({ session, isBroadcaster }: Props) {
  const { account, requireAuth, showToast } = useAppUi();
  const videoRef = useRef<HTMLVideoElement>(null);
  const sessionRef = useRef<WhepViewerSession | null>(null);
  const grantRef = useRef<WatchGrant | null>(null);
  const endedRef = useRef(session.status !== "LIVE");
  const sendLockRef = useRef(false);
  const sheetTitleId = useId();
  const [grant, setGrant] = useState<WatchGrant | null>(null);
  const [remainingMs, setRemainingMs] = useState(session.remainingMs);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureDraft, setCaptureDraft] = useState<CaptureDraft | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sheetEntered, setSheetEntered] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [ended, setEnded] = useState(session.status !== "LIVE");
  const [viewer, setViewer] = useState<WhepViewerState | null>(null);
  /** Once true, keep Ably presence through temporary WHEP recovery. */
  const [playbackStartedOnce, setPlaybackStartedOnce] = useState(false);

  const liveEnded = ended || session.status !== "LIVE";
  const hasCaptureSheet = Boolean(captureOpen && captureDraft);
  const suppressPublicUi = hasCaptureSheet || reportOpen;

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
        if (!cancelled) {
          setViewer({ ...state });
          if (isPlaybackHealthy(state) || state.phase === "playing") {
            setPlaybackStartedOnce(true);
          }
        }
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

  useEffect(() => {
    if (!hasCaptureSheet) {
      setSheetEntered(false);
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.requestAnimationFrame(() => setSheetEntered(true));
    return () => {
      document.body.style.overflow = prev;
      window.cancelAnimationFrame(t);
    };
  }, [hasCaptureSheet]);

  function clearCaptureDraft() {
    setCaptureOpen(false);
    setCaptureDraft(null);
    setSendError(null);
    setSendBusy(false);
    sendLockRef.current = false;
  }

  async function captureAndOpenSheet() {
    if (!account) {
      requireAuth("capture an item", `/live/${session.id}`);
      return;
    }
    if (isBroadcaster) {
      showToast("You cannot Capture Item on your own Live");
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    if (
      !isCaptureAllowed(
        viewer || sessionRef.current?.getState() || idleViewerState(),
      )
    ) {
      showToast(LIVE_CAPTURE_RECONNECTING_MESSAGE);
      return;
    }
    setCaptureBusy(true);
    setSendError(null);
    try {
      const blob = await canvasFrame(v);
      if (!blob || v.videoWidth <= 0) {
        showToast(LIVE_CAPTURE_RECONNECTING_MESSAGE);
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

      const prep = await fetch(`/api/live/sessions/${session.id}/capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: data.url,
          viewedOffsetSeconds: Math.floor(v.currentTime || 0),
        }),
      });
      if (!prep.ok) {
        const err = (await prep.json().catch(() => ({}))) as { error?: string };
        showToast(err.error || "Could not prepare message");
        return;
      }
      const prepared = (await prep.json()) as {
        conversationId: string;
        suggestedText: string;
        imageUrl: string;
        sourcerUsername?: string;
        autoSent?: boolean;
      };
      if (prepared.autoSent) {
        showToast("Could not prepare message");
        return;
      }

      const broadcasterName =
        session.broadcaster.name ||
        (session.broadcaster.username
          ? `@${session.broadcaster.username}`
          : "Sourcer");
      const sourcerLabel =
        prepared.sourcerUsername ||
        (session.broadcaster.username
          ? `@${session.broadcaster.username}`
          : broadcasterName);

      setCaptureDraft({
        imageUrl: prepared.imageUrl || data.url,
        conversationId: prepared.conversationId,
        text: prepared.suggestedText || fallbackSuggestedText(session.title),
        sourcerLabel,
      });
      setCaptureOpen(true);
    } finally {
      setCaptureBusy(false);
    }
  }

  async function sendCaptureMessage() {
    if (!captureDraft || sendBusy || sendLockRef.current) return;
    const text = captureDraft.text.trim();
    if (!text && !captureDraft.imageUrl) return;

    sendLockRef.current = true;
    setSendBusy(true);
    setSendError(null);
    const clientMessageId = `livecap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    try {
      const res = await fetch(
        `/api/conversations/${captureDraft.conversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            attachmentUrls: [captureDraft.imageUrl],
            clientMessageId,
          }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setSendError(data.error || "Could not send message");
        return;
      }
      showToast("Message sent.");
      clearCaptureDraft();
    } catch {
      setSendError("Could not send message");
    } finally {
      setSendBusy(false);
      sendLockRef.current = false;
    }
  }

  async function retakeCapture() {
    if (captureBusy || sendBusy) return;
    clearCaptureDraft();
    await captureAndOpenSheet();
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

  // Keep Capture sheet mounted when Live ends so unsent drafts can still send.
  // Do not early-return away from the sheet (that would hide the composer).
  if (liveEnded && !hasCaptureSheet) {
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
    !liveEnded &&
    !isBroadcaster &&
    isCaptureAllowed(viewer || idleViewerState());

  return (
    <div className="relative overflow-hidden rounded-2xl bg-black">
      {/*
        Keep the same <video> mounted for the whole LIVE watch lifetime —
        including while the Capture bottom sheet is open — so WHEP / PC are
        not torn down by sheet open/close. Overlay Was Live when ended with
        an unsent draft still open (no post-Live playback).
      */}
      <video
        ref={videoRef}
        className="aspect-[9/16] w-full object-cover"
        playsInline
        autoPlay
        muted={isBroadcaster}
      />
      {liveEnded ? (
        <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center bg-navy-mid text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
            Was Live
          </p>
          <p className="mt-2 text-sm text-white/70">Replay is not available.</p>
        </div>
      ) : null}
      {!liveEnded && showReconnecting ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-white">
            {WHEP_RECONNECT_MESSAGE}
          </p>
        </div>
      ) : null}
      {!liveEnded && showAutoplay ? (
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
      {!liveEnded && showFailed ? (
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
      {!liveEnded ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[5] flex items-start justify-between bg-gradient-to-b from-black/70 to-transparent p-4">
          <div className="min-w-0 pr-3">
            <LiveBadge />
            <p className="mt-2 text-sm font-medium text-white">{session.title}</p>
            <p className="text-xs text-white/60">{session.locationLabel}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <LiveTimer remainingMs={remainingMs} />
          </div>
        </div>
      ) : null}

      {/*
        Ably engagement overlay — comments + viewer count. Must NOT remount
        the WHEP <video> above. Capture sheet suppresses public UI only.
      */}
      {!liveEnded || hasCaptureSheet ? (
        <LiveEngagementOverlay
          liveSessionId={session.id}
          active={!liveEnded}
          allowPresence={playbackStartedOnce && !liveEnded && !isBroadcaster}
          isBroadcaster={isBroadcaster}
          suppressPublicUi={suppressPublicUi || liveEnded}
          showComposer={!isBroadcaster}
        />
      ) : null}

      {!liveEnded ? (
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-0 z-[8] bg-gradient-to-t from-black/80 to-transparent px-4 pt-8 ${
            isBroadcaster ? "pb-4" : "pb-[3.25rem]"
          }`}
          style={
            isBroadcaster
              ? undefined
              : { paddingBottom: "max(3.25rem, calc(2.75rem + env(safe-area-inset-bottom)))" }
          }
        >
          <div className="pointer-events-auto flex flex-wrap justify-end gap-2">
            {!isBroadcaster ? (
              <button
                type="button"
                onClick={() => void captureAndOpenSheet()}
                disabled={!captureEnabled}
                className="rounded-lg bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-navy disabled:cursor-not-allowed disabled:opacity-40"
              >
                {captureBusy ? "Capturing…" : "Capture Item"}
              </button>
            ) : null}
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
      ) : null}

      {hasCaptureSheet && captureDraft ? (
        <div
          className="absolute inset-0 z-20 flex items-end justify-center"
          role="presentation"
        >
          <div
            className="absolute inset-0 bg-gradient-to-t from-navy/80 via-navy/35 to-transparent"
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={sheetTitleId}
            className={`relative z-10 flex max-h-[min(78vh,640px)] w-full max-w-md flex-col rounded-t-2xl border border-white/10 bg-navy shadow-[0_-12px_40px_rgba(0,0,0,0.45)] transition-transform duration-300 ease-out sm:mb-3 sm:rounded-2xl ${
              sheetEntered ? "translate-y-0" : "translate-y-full"
            }`}
            style={{
              paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
            }}
          >
            <div className="flex items-center justify-between px-4 pb-1 pt-3">
              <div className="mx-auto h-1 w-10 rounded-full bg-white/20 sm:hidden" />
              <button
                type="button"
                onClick={() => clearCaptureDraft()}
                disabled={sendBusy}
                className="absolute right-3 top-3 min-h-11 min-w-11 rounded-lg px-3 text-sm text-white/70 hover:bg-white/5 hover:text-white disabled:opacity-40"
                aria-label="Close capture"
              >
                Close
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-1">
              <p
                id={sheetTitleId}
                className="text-xs font-semibold uppercase tracking-[0.14em] text-white/50"
              >
                Capture Item
              </p>
              <p className="mt-1 text-sm font-medium text-white">
                {session.broadcaster.name || "Sourcer"}
                {session.broadcaster.username ? (
                  <span className="ml-2 text-white/55">
                    @{session.broadcaster.username}
                  </span>
                ) : null}
              </p>
              {liveEnded ? (
                <p className="mt-2 text-xs text-amber-200/90">
                  This Live has ended. You can still send your private message.
                </p>
              ) : null}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={captureDraft.imageUrl}
                alt="Captured Live frame"
                className="mt-3 max-h-44 w-full rounded-xl object-contain bg-black/40"
              />
              <label className="mt-3 block text-xs font-medium uppercase tracking-[0.1em] text-white/45">
                Message to {captureDraft.sourcerLabel}
              </label>
              <textarea
                value={captureDraft.text}
                onChange={(e) => {
                  const next = e.target.value;
                  setCaptureDraft((prev) =>
                    prev ? { ...prev, text: next } : prev,
                  );
                }}
                rows={3}
                disabled={sendBusy}
                className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-navy-mid px-3 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-electric/60 focus:outline-none disabled:opacity-60"
                placeholder="Write a private message…"
              />
              {sendError ? (
                <p className="mt-2 text-sm text-red-300" role="alert">
                  {sendError}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-white/10 px-4 pt-3">
              <button
                type="button"
                onClick={() => void sendCaptureMessage()}
                disabled={
                  sendBusy ||
                  (!captureDraft.text.trim() && !captureDraft.imageUrl)
                }
                className="min-h-11 flex-1 rounded-lg bg-electric px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                {sendBusy ? "Sending…" : "Send"}
              </button>
              <button
                type="button"
                onClick={() => void retakeCapture()}
                disabled={sendBusy || captureBusy || liveEnded}
                className="min-h-11 rounded-lg border border-white/20 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Retake
              </button>
              <button
                type="button"
                onClick={() => clearCaptureDraft()}
                disabled={sendBusy}
                className="min-h-11 rounded-lg px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-white/65 hover:text-white disabled:opacity-40"
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
