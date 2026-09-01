"use client";

import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { useRouter } from "next/navigation";
import { LIVE_CAPTURE_DRAFT_KEY, LIVE_REPORT_REASONS } from "@/lib/live/constants";
import { useAppUi } from "@/components/providers/AppProviders";
import { LiveBadge, LiveTimer } from "@/components/live/LiveBadge";
import { startWhepPlayback } from "@/components/live/whip";
import type { LiveSessionPublic } from "@/lib/live/public-types";

type WatchGrant = {
  playback: {
    hlsUrl: string;
    whepUrl: string | null;
    thumbnailUrl: string;
    tokenExp: number;
  };
  endsAt: string;
  serverNow: string;
};

type Props = {
  session: LiveSessionPublic;
  isBroadcaster: boolean;
};

function supportsNativeHls(): boolean {
  if (typeof document === "undefined") return false;
  const v = document.createElement("video");
  return v.canPlayType("application/vnd.apple.mpegurl") !== "";
}

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
  const hlsRef = useRef<Hls | null>(null);
  const whepRef = useRef<RTCPeerConnection | null>(null);
  const [grant, setGrant] = useState<WatchGrant | null>(null);
  const [remainingMs, setRemainingMs] = useState(session.remainingMs);
  const [behindLive, setBehindLive] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureUrl, setCaptureUrl] = useState<string | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [ended, setEnded] = useState(session.status !== "LIVE");
  const [usingWhep, setUsingWhep] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const stallTimer = useRef<number | null>(null);

  async function loadGrant() {
    const res = await fetch(`/api/live/sessions/${session.id}/watch`, {
      method: "POST",
    });
    if (res.status === 401) {
      requireAuth("watch Live", `/live/${session.id}`);
      return null;
    }
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (data.code === "NOT_LIVE") setEnded(true);
      throw new Error(data.error || "Cannot watch");
    }
    return (await res.json()) as WatchGrant;
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await loadGrant();
        if (!cancelled && next) setGrant(next);
      } catch (err) {
        if (!cancelled) {
          showToast(err instanceof Error ? err.message : "Cannot watch Live");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void fetch(`/api/live/sessions/${session.id}`, { cache: "no-store" })
        .then(async (res) => {
          const data = (await res.json()) as { session?: LiveSessionPublic };
          if (data.session?.status !== "LIVE") {
            setEnded(true);
            setReconnecting(false);
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
        setEnded(true);
        const v = videoRef.current;
        if (v) v.pause();
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [session.endsAt, session.status, grant?.endsAt]);

  useEffect(() => {
    if (!grant || ended) return;
    const media = videoRef.current;
    if (!media) return;
    const el: HTMLVideoElement = media;
    let cancelled = false;

    async function attach() {
      destroy();
      const hlsUrl = grant!.playback.hlsUrl;
      el.crossOrigin = "anonymous";
      el.playsInline = true;

      const tryHls = () =>
        new Promise<boolean>((resolve) => {
          if (supportsNativeHls()) {
            el.src = hlsUrl;
            el.addEventListener(
              "loadedmetadata",
              () => resolve(true),
              { once: true },
            );
            el.addEventListener("error", () => resolve(false), { once: true });
            window.setTimeout(() => resolve(el.readyState >= 1), 4000);
            return;
          }
          if (Hls.isSupported()) {
            const hls = new Hls({
              lowLatencyMode: true,
              liveDurationInfinity: true,
              backBufferLength: 1800,
            });
            hlsRef.current = hls;
            hls.loadSource(hlsUrl);
            hls.attachMedia(el);
            hls.on(Hls.Events.MANIFEST_PARSED, () => resolve(true));
            hls.on(Hls.Events.ERROR, (_e, data) => {
              if (data.fatal) {
                setReconnecting(true);
                resolve(false);
              }
            });
            window.setTimeout(() => resolve(el.readyState >= 1), 5000);
            return;
          }
          resolve(false);
        });

      const ok = await tryHls();
      if (cancelled) return;
      if (ok) {
        setUsingWhep(false);
        setReconnecting(false);
        void el.play().catch(() => {});
        return;
      }
      if (grant!.playback.whepUrl) {
        setUsingWhep(true);
        try {
          whepRef.current = await startWhepPlayback(
            grant!.playback.whepUrl,
            el,
          );
          void el.play().catch(() => {});
        } catch {
          setReconnecting(true);
        }
      }
    }

    function destroy() {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      whepRef.current?.close();
      whepRef.current = null;
      el.removeAttribute("src");
      el.srcObject = null;
      el.load();
    }

    void attach();
    return () => {
      cancelled = true;
      destroy();
    };
  }, [grant, ended, showToast]);

  useEffect(() => {
    if (!grant) return;
    const expMs = grant.playback.tokenExp * 1000;
    const refreshIn = Math.max(5_000, expMs - Date.now() - 10_000);
    const t = window.setTimeout(() => {
      void loadGrant().then((next) => {
        if (next) setGrant(next);
      });
    }, refreshIn);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grant?.playback.tokenExp]);

  function onTime() {
    const v = videoRef.current;
    if (!v) return;
    setCurrent(v.currentTime);
    const seekable = v.seekable;
    if (seekable.length) {
      const end = seekable.end(seekable.length - 1);
      const start = seekable.start(0);
      setDuration(end - start);
      setBehindLive(end - v.currentTime > 3);
    }
    if (v.readyState >= 2 && !v.paused) {
      setReconnecting(false);
      if (stallTimer.current) {
        window.clearTimeout(stallTimer.current);
        stallTimer.current = null;
      }
    }
  }

  function onWaiting() {
    if (stallTimer.current) window.clearTimeout(stallTimer.current);
    stallTimer.current = window.setTimeout(() => {
      if (!ended && session.status === "LIVE") setReconnecting(true);
    }, 4000);
  }

  function onPlaying() {
    setReconnecting(false);
    if (stallTimer.current) {
      window.clearTimeout(stallTimer.current);
      stallTimer.current = null;
    }
  }

  function jumpToLive() {
    const v = videoRef.current;
    if (!v || !v.seekable.length) return;
    v.currentTime = v.seekable.end(v.seekable.length - 1);
    void v.play();
  }

  function onScrub(value: number) {
    const v = videoRef.current;
    if (!v || !v.seekable.length) return;
    const start = v.seekable.start(0);
    v.currentTime = start + value;
  }

  async function captureItem() {
    if (!account) {
      requireAuth("capture an item", `/live/${session.id}`);
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    setCaptureBusy(true);
    try {
      let blob = await canvasFrame(v);
      if (!blob) {
        const t = Math.floor(v.currentTime || 0);
        const res = await fetch(
          `/api/live/sessions/${session.id}/capture-frame?t=${t}`,
        );
        if (!res.ok) {
          showToast("Could not capture this frame");
          return;
        }
        blob = await res.blob();
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
    setEnded(true);
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

  const dvrMax = Math.max(duration, 0);

  return (
    <div className="relative overflow-hidden rounded-2xl bg-black">
      <video
        ref={videoRef}
        className="aspect-[9/16] w-full object-cover"
        playsInline
        autoPlay
        muted={isBroadcaster}
        onTimeUpdate={onTime}
        onWaiting={onWaiting}
        onPlaying={onPlaying}
        crossOrigin="anonymous"
      />
      {reconnecting ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-white">
            Broadcaster reconnecting…
          </p>
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
        {!usingWhep && dvrMax > 1 ? (
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={dvrMax}
              step={0.25}
              value={Math.min(current, dvrMax)}
              onChange={(e) => onScrub(Number(e.target.value))}
              className="h-1 w-full accent-red-500"
              aria-label="DVR timeline"
            />
            <button
              type="button"
              onClick={jumpToLive}
              className={`shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                behindLive ? "text-white" : "text-red-400"
              }`}
            >
              Jump to Live
            </button>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void captureItem()}
            disabled={captureBusy}
            className="rounded-lg bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-navy"
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
