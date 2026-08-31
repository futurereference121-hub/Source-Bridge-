"use client";

import { useEffect, useRef, useState } from "react";
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
};

export function GoLiveStudio() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const whipRef = useRef<Awaited<ReturnType<typeof startWhipPublish>> | null>(
    null,
  );
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [title, setTitle] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [facing, setFacing] = useState<"user" | "environment">("environment");
  const [micOn, setMicOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<LiveSessionPublic | null>(null);
  const [remainingMs, setRemainingMs] = useState(LIVE_SESSION_DURATION_MS);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/live/eligibility", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: Eligibility) => setEligibility(data))
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
          audio: true,
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
      if (left <= 0) void endLive();
    }, 250);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live?.endsAt]);

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
      const stream = streamRef.current;
      if (!stream) {
        setError("Camera is not ready");
        return;
      }
      whipRef.current = await startWhipPublish(data.publish.whipUrl, stream);
      const retry = async () => {
        if (!streamRef.current || !data.publish) return;
        try {
          await stopWhipPublish(whipRef.current);
          whipRef.current = await startWhipPublish(
            data.publish.whipUrl,
            streamRef.current,
          );
        } catch {
          /* ingest timeoutSeconds=30 is the server grace window */
        }
      };
      whipRef.current.pc.onconnectionstatechange = () => {
        const st = whipRef.current?.pc.connectionState;
        if (st === "failed" || st === "disconnected") {
          window.setTimeout(() => void retry(), 1500);
        }
      };
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

  async function endLive() {
    if (!live) return;
    await fetch(`/api/live/sessions/${live.id}/end`, { method: "POST" });
    await stopWhipPublish(whipRef.current);
    whipRef.current = null;
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

  if (eligibility && !eligibility.allowed) {
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
        {live ? (
          <div className="absolute left-4 top-4">
            <LiveTimer remainingMs={remainingMs} />
          </div>
        ) : null}
      </div>

      {!live ? (
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
      ) : (
        <button
          type="button"
          onClick={() => void endLive()}
          className="mt-4 w-full rounded-lg bg-red-600 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-white"
        >
          End Live
        </button>
      )}
    </div>
  );
}
