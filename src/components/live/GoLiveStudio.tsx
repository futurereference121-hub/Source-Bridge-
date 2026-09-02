"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LiveTimer } from "@/components/live/LiveBadge";
import { startWhipPublish, stopWhipPublish } from "@/components/live/whip";
import { emitLiveChanged } from "@/lib/live-surface-sync";
import { LIVE_SESSION_DURATION_MS } from "@/lib/live/constants";
import type { LiveSessionPublic } from "@/lib/live/public-types";

type Eligibility = {
  allowed: boolean;
  message: string;
  available: boolean;
  payoutsEnabled: boolean;
  cooldownUntil: string | null;
  activeSession?: LiveSessionPublic | null;
};

type PublishState = "idle" | "connecting" | "live" | "reconnecting";

const DEVICE_KEY = "sb-live-device-id";

function getDeviceId(): string {
  if (typeof window === "undefined") return "server";
  let id = sessionStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function GoLiveStudio() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const whipRef = useRef<Awaited<ReturnType<typeof startWhipPublish>> | null>(
    null,
  );
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const localLiveRef = useRef<LiveSessionPublic | null>(null);
  const publishUrlRef = useRef<string | null>(null);
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [title, setTitle] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [facing, setFacing] = useState<"user" | "environment">("environment");
  const [micOn, setMicOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<LiveSessionPublic | null>(null);
  const [remainingMs, setRemainingMs] = useState(LIVE_SESSION_DURATION_MS);
  const [error, setError] = useState<string | null>(null);
  const [publishState, setPublishState] = useState<PublishState>("idle");
  const [handoffPrompt, setHandoffPrompt] = useState(false);
  const deviceId = useRef(getDeviceId());

  const acquireWakeLock = useCallback(async () => {
    if (!("wakeLock" in navigator)) return;
    try {
      wakeLockRef.current = await navigator.wakeLock.request("screen");
    } catch {
      /* unsupported or denied */
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    void wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
  }, []);

  useEffect(() => {
    localLiveRef.current = live;
  }, [live]);

  useEffect(() => {
    void fetch("/api/live/eligibility", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: Eligibility) => {
        setEligibility(data);
        if (data.activeSession) {
          setLive(data.activeSession);
          setTitle(data.activeSession.title);
          setLocationLabel(data.activeSession.locationLabel);
          setRemainingMs(data.activeSession.remainingMs);
          if (data.activeSession.status === "LIVE") {
            setPublishState("reconnecting");
            setHandoffPrompt(true);
          }
        }
      })
      .catch(() =>
        setEligibility({
          allowed: false,
          available: false,
          payoutsEnabled: false,
          cooldownUntil: null,
          message: "Could not check Live eligibility",
        }),
      );
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: {
            facingMode: facing,
            width: { ideal: 720 },
            height: { ideal: 1280 },
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        stream.getAudioTracks().forEach((t) => {
          t.enabled = micOn;
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }
      } catch {
        setError("Camera access is required to go Live.");
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [facing, micOn]);

  useEffect(() => {
    if (!live?.endsAt) return;
    const id = window.setInterval(() => {
      const left = Math.max(0, Date.parse(live.endsAt!) - Date.now());
      setRemainingMs(left);
      if (left <= 0 && live.status === "LIVE") void endLive();
    }, 250);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live?.endsAt, live?.status]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && localLiveRef.current?.status === "LIVE") {
        void acquireWakeLock();
        if (publishState === "reconnecting" && publishUrlRef.current) {
          void republish(publishUrlRef.current);
        }
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [acquireWakeLock, publishState]);

  async function republish(whipUrl: string) {
    const stream = streamRef.current;
    if (!stream || !localLiveRef.current) return;
    setPublishState("reconnecting");
    try {
      await stopWhipPublish(whipRef.current);
      whipRef.current = await startWhipPublish(whipUrl, stream);
      publishUrlRef.current = whipUrl;
      attachReconnectHandlers(whipUrl);
      setPublishState("live");
      setHandoffPrompt(false);
      void acquireWakeLock();
    } catch {
      setPublishState("reconnecting");
    }
  }

  function attachReconnectHandlers(whipUrl: string) {
    if (!whipRef.current) return;
    whipRef.current.pc.onconnectionstatechange = () => {
      const st = whipRef.current?.pc.connectionState;
      if (st === "failed" || st === "disconnected") {
        setPublishState("reconnecting");
        window.setTimeout(() => {
          if (localLiveRef.current?.status === "LIVE") {
            void republish(whipUrl);
          }
        }, 1500);
      } else if (st === "connected") {
        setPublishState("live");
      }
    };
    streamRef.current?.getVideoTracks().forEach((track) => {
      track.onended = () => {
        if (localLiveRef.current?.status === "LIVE") {
          setPublishState("reconnecting");
          window.setTimeout(() => void republish(whipUrl), 1500);
        }
      };
    });
  }

  async function startPublish(whipUrl: string) {
    const stream = streamRef.current;
    if (!stream) {
      setError("Camera is not ready");
      return false;
    }
    setPublishState("connecting");
    try {
      whipRef.current = await startWhipPublish(whipUrl, stream);
      publishUrlRef.current = whipUrl;
      attachReconnectHandlers(whipUrl);
      setPublishState("live");
      void acquireWakeLock();
      return true;
    } catch (err) {
      setPublishState("reconnecting");
      setError(err instanceof Error ? err.message : "Could not publish");
      return false;
    }
  }

  async function goLive() {
    if (!eligibility?.allowed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/live/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, locationLabel }),
      });
      const data = (await res.json()) as {
        error?: string;
        session?: LiveSessionPublic;
        publish?: { whipUrl: string };
      };
      if (!res.ok || !data.session || !data.publish) {
        setError(data.error || "Could not go Live");
        return;
      }
      const ok = await startPublish(data.publish.whipUrl);
      if (!ok) return;
      const go = await fetch(`/api/live/sessions/${data.session.id}/go`, {
        method: "POST",
      });
      const liveBody = (await go.json()) as {
        session?: LiveSessionPublic;
        error?: string;
      };
      if (!go.ok || !liveBody.session) {
        setError(liveBody.error || "Could not go Live");
        return;
      }
      setLive(liveBody.session);
      setRemainingMs(liveBody.session.remainingMs);
      emitLiveChanged({
        sessionId: liveBody.session.id,
        memberId: liveBody.session.broadcaster.id,
        status: "LIVE",
        version: liveBody.session.version,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not go Live");
    } finally {
      setBusy(false);
    }
  }

  async function resumeLive(takeover = false) {
    if (!live || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/live/sessions/${live.id}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ takeover, deviceId: deviceId.current }),
      });
      const data = (await res.json()) as {
        error?: string;
        session?: LiveSessionPublic;
        publish?: { whipUrl: string };
      };
      if (!res.ok || !data.session || !data.publish) {
        setError(data.error || "Could not resume Live");
        return;
      }
      setLive(data.session);
      setTitle(data.session.title);
      setLocationLabel(data.session.locationLabel);
      setRemainingMs(data.session.remainingMs);
      const ok = await startPublish(data.publish.whipUrl);
      if (!ok) return;
      if (data.session.status === "PREPARING") {
        const go = await fetch(`/api/live/sessions/${data.session.id}/go`, {
          method: "POST",
        });
        const liveBody = (await go.json()) as {
          session?: LiveSessionPublic;
          error?: string;
        };
        if (!go.ok || !liveBody.session) {
          setError(liveBody.error || "Could not go Live");
          return;
        }
        setLive(liveBody.session);
        setRemainingMs(liveBody.session.remainingMs);
      }
      emitLiveChanged({
        sessionId: data.session.id,
        memberId: data.session.broadcaster.id,
        status: "LIVE",
        version: data.session.version,
      });
      setHandoffPrompt(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resume Live");
    } finally {
      setBusy(false);
    }
  }

  async function endLive() {
    if (!live) return;
    await fetch(`/api/live/sessions/${live.id}/end`, { method: "POST" });
    await stopWhipPublish(whipRef.current);
    whipRef.current = null;
    publishUrlRef.current = null;
    releaseWakeLock();
    emitLiveChanged({
      sessionId: live.id,
      memberId: live.broadcaster.id,
      status: "ENDED",
      version: live.version + 1,
    });
    router.push(`/live/${live.id}`);
  }

  if (eligibility && !eligibility.available) {
    return (
      <p className="text-sm text-white/60">
        Source Bridge Live is not available on this environment yet.
      </p>
    );
  }

  if (
    eligibility &&
    !eligibility.allowed &&
    !eligibility.activeSession
  ) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-white/70">{eligibility.message}</p>
        {eligibility.cooldownUntil ? (
          <p className="text-xs text-white/45">
            Available again at{" "}
            {new Date(eligibility.cooldownUntil).toLocaleTimeString()}
          </p>
        ) : null}
      </div>
    );
  }

  const isLive = live?.status === "LIVE";
  const showResume = Boolean(
    eligibility?.activeSession && !isLive && publishState !== "live",
  );

  return (
    <div className="mx-auto max-w-md">
      <div className="relative overflow-hidden rounded-2xl bg-black">
        <video
          ref={videoRef}
          className="aspect-[9/16] w-full object-cover"
          muted
          playsInline
          autoPlay
        />
        {isLive ? (
          <div className="absolute left-4 top-4">
            <LiveTimer remainingMs={remainingMs} />
          </div>
        ) : null}
        {publishState === "reconnecting" && isLive ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-white">
              Reconnecting…
            </p>
          </div>
        ) : null}
      </div>

      {handoffPrompt && isLive ? (
        <div className="mt-4 space-y-3 rounded-xl border border-white/15 bg-white/5 p-4">
          <p className="text-sm text-white/75">
            Your Live is still running. Resume publishing on this device.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void resumeLive(true)}
            className="w-full rounded-lg bg-red-600 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-white disabled:opacity-40"
          >
            {busy ? "Connecting…" : "Resume Live on this device"}
          </button>
        </div>
      ) : null}

      {!isLive && !showResume ? (
        <div className="mt-4 space-y-3">
          <label className="block text-xs uppercase tracking-[0.14em] text-white/45">
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              className="mt-1 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white"
              placeholder="What are you sourcing?"
            />
          </label>
          <label className="block text-xs uppercase tracking-[0.14em] text-white/45">
            Location
            <input
              value={locationLabel}
              onChange={(e) => setLocationLabel(e.target.value)}
              maxLength={80}
              className="mt-1 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white"
              placeholder="City, neighbourhood, or market"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() =>
                setFacing((f) => (f === "user" ? "environment" : "user"))
              }
              className="rounded-lg border border-white/20 px-3 py-2 text-xs uppercase tracking-[0.12em] text-white"
            >
              Flip camera
            </button>
            <button
              type="button"
              onClick={() => {
                setMicOn((v) => !v);
                streamRef.current?.getAudioTracks().forEach((t) => {
                  t.enabled = !micOn;
                });
              }}
              className="rounded-lg border border-white/20 px-3 py-2 text-xs uppercase tracking-[0.12em] text-white"
            >
              {micOn ? "Mic on" : "Mic off"}
            </button>
          </div>
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
          <button
            type="button"
            disabled={busy || title.trim().length < 2 || locationLabel.trim().length < 2}
            onClick={() => void goLive()}
            className="w-full rounded-lg bg-red-600 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-white disabled:opacity-40"
          >
            {busy ? "Starting…" : "Go Live"}
          </button>
        </div>
      ) : null}

      {showResume ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-white/70">
            You have a Live in progress: <strong>{live?.title}</strong>
          </p>
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void resumeLive(false)}
            className="w-full rounded-lg bg-red-600 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-white disabled:opacity-40"
          >
            {busy ? "Resuming…" : "Resume Live"}
          </button>
        </div>
      ) : null}

      {isLive && !handoffPrompt ? (
        <button
          type="button"
          onClick={() => void endLive()}
          className="mt-4 w-full rounded-lg bg-red-600 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-white"
        >
          End Live
        </button>
      ) : null}
    </div>
  );
}
