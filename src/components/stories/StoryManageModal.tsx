"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { useAppUi } from "@/components/providers/AppProviders";
import type { StoryClipPublic } from "@/lib/story-constants";

type Props = {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
};

function formatRemaining(expiresAt: string) {
  const ms = Date.parse(expiresAt) - Date.now();
  if (ms <= 0) return "Expired";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

export function StoryManageModal({ open, onClose, onChanged }: Props) {
  const { showToast } = useAppUi();
  const [clips, setClips] = useState<StoryClipPublic[]>([]);
  const [activeSeconds, setActiveSeconds] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stories");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setClips(data.clips || []);
      setActiveSeconds(data.activeSeconds || 0);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load Stories");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) return null;

  async function onDelete(clipId: string) {
    if (!window.confirm("Delete this Story clip?")) return;
    setBusyId(clipId);
    try {
      const res = await fetch(`/api/stories/${clipId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Delete failed");
      showToast("Story deleted.");
      await load();
      onChanged();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="flex max-h-[min(90svh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-white/15 bg-[#071428] text-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="font-display text-2xl">Manage Story</h2>
            <p className="mt-1 text-xs text-white/45">
              {Math.round(activeSeconds / 60)} / 90 minutes active
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-white/50 hover:text-white"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-sm text-white/45">Loading…</p>
          ) : clips.length === 0 ? (
            <p className="text-sm text-white/55">No active Story clips.</p>
          ) : (
            <ul className="space-y-3">
              {clips.map((clip) => (
                <li
                  key={clip.id}
                  className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"
                >
                  <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-navy-mid">
                    {clip.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={clip.thumbnailUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white/85">
                      {clip.durationSeconds}s · {formatRemaining(clip.expiresAt)}
                    </p>
                    <p className="mt-0.5 text-xs text-white/40">
                      Uploaded{" "}
                      {new Date(clip.createdAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                    <p className="mt-1 text-xs text-electric/90">
                      {clip.viewCount ?? 0} views
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyId === clip.id}
                    onClick={() => void onDelete(clip.id)}
                    className="self-start rounded-lg border border-red-400/30 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.12em] text-red-200 hover:border-red-300 disabled:opacity-50"
                  >
                    {busyId === clip.id ? "…" : "Delete"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
