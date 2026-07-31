"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Volume2, VolumeX, X, Flag } from "lucide-react";
import { SafeMemberImage } from "@/components/ui/SafeMemberImage";
import { STORY_REPORT_REASONS } from "@/lib/story-constants";
import { useAppUi } from "@/components/providers/AppProviders";

type Clip = {
  id: string;
  videoUrl: string;
  thumbnailUrl: string;
  durationSeconds: number;
  createdAt: string;
  viewed?: boolean;
};

type Props = {
  userId: string;
  onClose: () => void;
};

function relativeAge(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (mins < 60) return `${mins || 1}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const viewedRef = useRef<Set<string>>(new Set());
  const holdTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/stories/user/${userId}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Story not found");
        if (cancelled) return;
        setUser(data.user);
        setClips(data.clips || []);
        setIndex(0);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Story not found");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const current = clips[index] || null;

  const recordView = useCallback(
    async (clipId: string) => {
      if (viewedRef.current.has(clipId)) return;
      viewedRef.current.add(clipId);
      try {
        await fetch(`/api/stories/${clipId}/view`, { method: "POST" });
      } catch {
        /* ignore */
      }
    },
    [],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !current) return;
    video.load();
    void video.play().catch(() => undefined);
    setPaused(false);
    const t = window.setTimeout(() => {
      void recordView(current.id);
    }, 1500);
    return () => window.clearTimeout(t);
  }, [current, recordView]);

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
          void v.play();
          setPaused(false);
        } else {
          v.pause();
          setPaused(true);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clips.length, onClose]);

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

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black">
      <div className="relative flex h-[100svh] w-full max-w-lg flex-col bg-black sm:h-[min(100svh,900px)] sm:rounded-xl sm:border sm:border-white/10">
        {/* Progress */}
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
          {loading ? (
            <p className="text-sm text-white/50">Loading Story…</p>
          ) : error ? (
            <div className="px-6 text-center">
              <p className="text-sm text-white/70">{error}</p>
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
                key={current.id}
                src={current.videoUrl}
                poster={current.thumbnailUrl || undefined}
                className="max-h-full max-w-full object-contain"
                playsInline
                muted={muted}
                onEnded={() => go(1)}
                onError={() =>
                  setError("This clip could not be played. Try the next one.")
                }
              />
              {/* Tap zones */}
              <button
                type="button"
                aria-label="Previous"
                className="absolute inset-y-0 left-0 w-1/3"
                onClick={() => go(-1)}
                onPointerDown={() => {
                  holdTimer.current = window.setTimeout(() => {
                    videoRef.current?.pause();
                    setPaused(true);
                  }, 200);
                }}
                onPointerUp={() => {
                  if (holdTimer.current) window.clearTimeout(holdTimer.current);
                  if (paused) {
                    void videoRef.current?.play();
                    setPaused(false);
                  }
                }}
              />
              <button
                type="button"
                aria-label="Next"
                className="absolute inset-y-0 right-0 w-1/3"
                onClick={() => go(1)}
                onPointerDown={() => {
                  holdTimer.current = window.setTimeout(() => {
                    videoRef.current?.pause();
                    setPaused(true);
                  }, 200);
                }}
                onPointerUp={() => {
                  if (holdTimer.current) window.clearTimeout(holdTimer.current);
                  if (paused) {
                    void videoRef.current?.play();
                    setPaused(false);
                  }
                }}
              />
            </>
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
