"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Volume2, VolumeX, X, Flag, Play } from "lucide-react";
import { SafeMemberImage } from "@/components/ui/SafeMemberImage";
import {
  STORY_REPORT_REASONS,
  StoryPlaybackErrorCode,
  storyPlaybackErrorMessage,
  type StoryPlaybackErrorCode as PlaybackCode,
} from "@/lib/story-constants";
import { useAppUi } from "@/components/providers/AppProviders";

type Clip = {
  id: string;
  videoUrl: string;
  thumbnailUrl: string;
  durationSeconds: number;
  createdAt: string;
  playbackExpiresAt?: string;
  viewed?: boolean;
};

type Props = {
  userId: string;
  onClose: () => void;
};

type UiPhase =
  | "loading_meta"
  | "buffering"
  | "tap_to_play"
  | "playing"
  | "error";

function relativeAge(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins || 1}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function logStage(
  stage: string,
  detail: Record<string, string | number | boolean | undefined>,
) {
  // Structured playback trace — never includes media URLs or tokens.
  console.info("[story-playback]", { stage, ...detail, t: Date.now() });
}

function mediaErrorCode(video: HTMLVideoElement | null): PlaybackCode {
  const code = video?.error?.code;
  if (code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
    return StoryPlaybackErrorCode.MEDIA_UNSUPPORTED;
  }
  if (code === MediaError.MEDIA_ERR_NETWORK) {
    return StoryPlaybackErrorCode.NETWORK_INTERRUPTED;
  }
  return StoryPlaybackErrorCode.STREAM_FAILED;
}

export function StoryViewer({ userId, onClose }: Props) {
  const { showToast, account } = useAppUi();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [user, setUser] = useState<{
    name: string;
    username: string | null;
    photo: string;
    isDemo?: boolean;
  } | null>(null);
  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [phase, setPhase] = useState<UiPhase>("loading_meta");
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState<PlaybackCode | "">("");
  const [reportOpen, setReportOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const viewedRef = useRef<Set<string>>(new Set());
  const holdTimer = useRef<number | null>(null);
  const refreshedRef = useRef<Set<string>>(new Set());
  const requestIdRef = useRef(
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 12)
      : Math.random().toString(36).slice(2, 10),
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setPhase("loading_meta");
      setError("");
      setErrorCode("");
      logStage("meta_request", {
        requestId: requestIdRef.current,
        userId,
        hostname: typeof window !== "undefined" ? window.location.hostname : "",
      });
      try {
        const res = await fetch(`/api/stories/user/${userId}`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const code =
            res.status === 404
              ? StoryPlaybackErrorCode.MEDIA_NOT_FOUND
              : StoryPlaybackErrorCode.STREAM_FAILED;
          throw Object.assign(
            new Error(data.error || storyPlaybackErrorMessage(code)),
            { code },
          );
        }
        if (cancelled) return;
        setUser(data.user);
        setClips(data.clips || []);
        setIndex(0);
        logStage("meta_ok", {
          requestId: requestIdRef.current,
          userId,
          clipCount: (data.clips || []).length,
          status: res.status,
        });
        if (!(data.clips || []).length) {
          setPhase("error");
          setErrorCode(StoryPlaybackErrorCode.MEDIA_NOT_FOUND);
          setError(
            storyPlaybackErrorMessage(StoryPlaybackErrorCode.MEDIA_NOT_FOUND),
          );
        } else {
          setPhase("buffering");
        }
      } catch (err) {
        if (!cancelled) {
          const code =
            err && typeof err === "object" && "code" in err
              ? (err as { code: PlaybackCode }).code
              : StoryPlaybackErrorCode.STREAM_FAILED;
          setErrorCode(code);
          setError(
            err instanceof Error
              ? err.message
              : storyPlaybackErrorMessage(code),
          );
          setPhase("error");
          logStage("meta_fail", {
            requestId: requestIdRef.current,
            userId,
            code,
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const current = clips[index] || null;

  const recordView = useCallback(async (clipId: string) => {
    if (viewedRef.current.has(clipId)) return;
    viewedRef.current.add(clipId);
    try {
      void fetch(`/api/stories/${clipId}/view`, { method: "POST" });
      logStage("view_recorded", {
        requestId: requestIdRef.current,
        userId,
        clipId,
      });
    } catch {
      /* non-blocking */
    }
  }, [userId]);

  const refreshPlaybackUrl = useCallback(async (clipId: string) => {
    if (refreshedRef.current.has(clipId)) return null;
    refreshedRef.current.add(clipId);
    logStage("playback_url_refresh", {
      requestId: requestIdRef.current,
      userId,
      clipId,
    });
    try {
      const res = await fetch(`/api/stories/${clipId}/playback`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.playbackUrl) return null;
      return {
        url: String(data.playbackUrl),
        expiresAt: String(data.expiresAt || ""),
      };
    } catch {
      return null;
    }
  }, [userId]);

  const tryPlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      await video.play();
      setPaused(false);
      setPhase("playing");
      logStage("playback_started", {
        requestId: requestIdRef.current,
        userId,
        clipId: current?.id,
      });
    } catch {
      setPhase("tap_to_play");
      setPaused(true);
      logStage("autoplay_blocked", {
        requestId: requestIdRef.current,
        userId,
        clipId: current?.id,
      });
    }
  }, [current?.id, userId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !current) return;

    setPhase("buffering");
    setError("");
    setErrorCode("");
    setPaused(false);
    video.load();
    void tryPlay();

    logStage("media_request", {
      requestId: requestIdRef.current,
      userId,
      clipId: current.id,
      hostname:
        typeof window !== "undefined" ? window.location.hostname : "",
    });
  }, [current, tryPlay, userId]);

  function go(delta: number) {
    setIndex((i) => {
      const next = i + delta;
      if (next < 0) return 0;
      if (next >= clips.length) {
        onClose();
        return i;
      }
      return next;
    });
  }

  async function handleMediaError() {
    if (!current) return;
    const code = mediaErrorCode(videoRef.current);
    const grantExpired =
      current.playbackExpiresAt &&
      Date.parse(current.playbackExpiresAt) < Date.now();

    if (grantExpired || code === StoryPlaybackErrorCode.STREAM_FAILED) {
      const refreshed = await refreshPlaybackUrl(current.id);
      if (refreshed) {
        setClips((prev) =>
          prev.map((c) =>
            c.id === current.id
              ? {
                  ...c,
                  videoUrl: refreshed.url,
                  playbackExpiresAt: refreshed.expiresAt || c.playbackExpiresAt,
                }
              : c,
          ),
        );
        setPhase("buffering");
        setErrorCode(StoryPlaybackErrorCode.URL_EXPIRED);
        return;
      }
    }

    setPhase("error");
    setErrorCode(code);
    setError(storyPlaybackErrorMessage(code, requestIdRef.current));
    logStage("media_error", {
      requestId: requestIdRef.current,
      userId,
      clipId: current.id,
      code,
      mediaError: videoRef.current?.error?.code,
    });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === " ") {
        e.preventDefault();
        const v = videoRef.current;
        if (!v) return;
        if (v.paused) {
          void tryPlay();
        } else {
          v.pause();
          setPaused(true);
          setPhase("tap_to_play");
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips.length, onClose, tryPlay]);

  async function submitReport(reason: string) {
    if (!current) return;
    try {
      const res = await fetch(`/api/stories/${current.id}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Report failed");
      showToast("Report submitted. Thank you.");
      setReportOpen(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Report failed");
    }
  }

  async function retryClip() {
    if (!current) return;
    refreshedRef.current.delete(current.id);
    const refreshed = await refreshPlaybackUrl(current.id);
    if (refreshed) {
      setClips((prev) =>
        prev.map((c) =>
          c.id === current.id
            ? {
                ...c,
                videoUrl: refreshed.url,
                playbackExpiresAt: refreshed.expiresAt || c.playbackExpiresAt,
              }
            : c,
        ),
      );
    }
    setError("");
    setErrorCode("");
    setPhase("buffering");
    const video = videoRef.current;
    if (video) {
      video.load();
      void tryPlay();
    }
  }

  const statusLabel =
    phase === "loading_meta"
      ? "Loading Story…"
      : phase === "buffering"
        ? "Buffering…"
        : phase === "tap_to_play"
          ? "Tap to play"
          : null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black">
      <div className="relative flex h-[100svh] w-full max-w-lg flex-col bg-black sm:h-[min(100svh,900px)] sm:rounded-xl sm:border sm:border-white/10">
        <div className="absolute inset-x-0 top-0 z-20 flex gap-1 px-3 pt-3">
          {clips.map((c, i) => (
            <div
              key={c.id}
              className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/25"
            >
              <div
                className={`h-full bg-white transition-all ${
                  i < index ? "w-full" : i === index ? "w-1/2" : "w-0"
                }`}
              />
            </div>
          ))}
        </div>

        <div className="absolute inset-x-0 top-4 z-20 flex items-center gap-3 px-4 pt-3">
          <div className="relative h-9 w-9 overflow-hidden rounded-lg">
            <SafeMemberImage
              src={user?.photo}
              alt=""
              fill
              sizes="36px"
              className="object-cover"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">
              {user?.username ? `@${user.username}` : user?.name || "Member"}
            </p>
            <p className="text-[11px] text-white/55">
              {current ? relativeAge(current.createdAt) : ""}
              {user?.isDemo ? " · Showcase" : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            className="rounded-lg p-2 text-white/80 hover:bg-white/10"
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          {account && account.id !== userId ? (
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              className="rounded-lg p-2 text-white/80 hover:bg-white/10"
              aria-label="Report Story"
            >
              <Flag size={18} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-white/80 hover:bg-white/10"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="relative flex flex-1 items-center justify-center overflow-hidden">
          {phase === "error" && !current ? (
            <div className="px-6 text-center">
              <p className="text-sm text-white/70">{error}</p>
              {errorCode ? (
                <p className="mt-1 text-[11px] text-white/35">{errorCode}</p>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                className="mt-4 text-xs uppercase tracking-[0.12em] text-electric"
              >
                Close
              </button>
            </div>
          ) : current ? (
            <>
              <video
                ref={videoRef}
                key={`${current.id}:${current.videoUrl.slice(-24)}`}
                src={current.videoUrl}
                poster={current.thumbnailUrl || undefined}
                className="max-h-full max-w-full object-contain"
                playsInline
                muted={muted}
                preload="auto"
                onLoadedMetadata={() => {
                  logStage("loadedmetadata", {
                    requestId: requestIdRef.current,
                    userId,
                    clipId: current.id,
                  });
                }}
                onCanPlay={() => {
                  logStage("canplay", {
                    requestId: requestIdRef.current,
                    userId,
                    clipId: current.id,
                  });
                  if (phase === "buffering") void tryPlay();
                }}
                onPlaying={() => {
                  setPhase("playing");
                  setPaused(false);
                  logStage("first_frame", {
                    requestId: requestIdRef.current,
                    userId,
                    clipId: current.id,
                  });
                  void recordView(current.id);
                }}
                onWaiting={() => {
                  if (!paused) setPhase("buffering");
                }}
                onStalled={() => {
                  if (!paused) setPhase("buffering");
                }}
                onEnded={() => go(1)}
                onError={() => void handleMediaError()}
              />

              {phase === "error" ? (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/70 px-6 text-center">
                  <p className="text-sm text-white/80">{error}</p>
                  {errorCode ? (
                    <p className="mt-1 text-[11px] text-white/40">{errorCode}</p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void retryClip()}
                    className="mt-4 rounded-lg bg-electric px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white"
                  >
                    Retry
                  </button>
                  {clips.length > index + 1 ? (
                    <button
                      type="button"
                      onClick={() => go(1)}
                      className="mt-3 text-xs uppercase tracking-[0.12em] text-white/55"
                    >
                      Next clip
                    </button>
                  ) : null}
                </div>
              ) : null}

{(phase === "buffering" || phase === "loading_meta") ? (
                <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center bg-black/35">
                  <p className="text-sm text-white/70">{statusLabel}</p>
                </div>
              ) : null}

              {phase === "tap_to_play" ? (
                <button
                  type="button"
                  className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/45"
                  onClick={() => void tryPlay()}
                  aria-label="Tap to play"
                >
                  <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/15 text-white">
                    <Play size={28} fill="currentColor" />
                  </span>
                  <span className="mt-3 text-sm text-white/80">Tap to play</span>
                </button>
              ) : null}

              {/* Tap zones — below overlays */}
              <button
                type="button"
                aria-label="Previous"
                className="absolute inset-y-0 left-0 z-[1] w-1/3"
                onClick={() => go(-1)}
                onPointerDown={() => {
                  holdTimer.current = window.setTimeout(() => {
                    videoRef.current?.pause();
                    setPaused(true);
                    setPhase("tap_to_play");
                  }, 200);
                }}
                onPointerUp={() => {
                  if (holdTimer.current) window.clearTimeout(holdTimer.current);
                  if (paused) void tryPlay();
                }}
              />
              <button
                type="button"
                aria-label="Next"
                className="absolute inset-y-0 right-0 z-[1] w-1/3"
                onClick={() => go(1)}
                onPointerDown={() => {
                  holdTimer.current = window.setTimeout(() => {
                    videoRef.current?.pause();
                    setPaused(true);
                    setPhase("tap_to_play");
                  }, 200);
                }}
                onPointerUp={() => {
                  if (holdTimer.current) window.clearTimeout(holdTimer.current);
                  if (paused) void tryPlay();
                }}
              />
            </>
          ) : phase === "loading_meta" ? (
            <p className="text-sm text-white/50">Loading Story…</p>
          ) : null}
        </div>

        {reportOpen ? (
          <div className="absolute inset-0 z-30 flex items-end bg-black/70 p-4 sm:items-center sm:justify-center">
            <div className="w-full max-w-sm rounded-xl border border-white/15 bg-[#071428] p-4">
              <p className="text-sm font-medium text-white">Report Story</p>
              <ul className="mt-3 space-y-1">
                {STORY_REPORT_REASONS.map((reason) => (
                  <li key={reason}>
                    <button
                      type="button"
                      onClick={() => void submitReport(reason)}
                      className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-white/80 hover:bg-white/[0.06]"
                    >
                      {reason}
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setReportOpen(false)}
                className="mt-2 w-full py-2 text-xs uppercase tracking-[0.12em] text-white/45"
              >
                Close
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
