"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import {
  MAX_STORY_CLIP_BYTES,
  MAX_STORY_CLIP_SECONDS,
  STORY_FORMAT_HINT,
  STORY_PRIVACY_NOTICE,
  STORY_VIDEO_ACCEPT,
} from "@/lib/story-constants";

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export function StoryCreateModal({ open, onClose, onSuccess }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");

  useEffect(() => {
    if (!open) {
      setBusy(false);
      setProgress(0);
      setError("");
      setFileName("");
    }
  }, [open]);

  if (!open) return null;

  async function readDuration(file: File): Promise<number> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        const d = video.duration;
        URL.revokeObjectURL(url);
        if (!Number.isFinite(d) || d <= 0) reject(new Error("duration"));
        else resolve(d);
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("duration"));
      };
      video.src = url;
    });
  }

  async function capturePoster(file: File): Promise<Blob | null> {
    try {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.src = url;
      video.muted = true;
      await video.play().catch(() => undefined);
      video.pause();
      video.currentTime = Math.min(0.4, (video.duration || 1) * 0.1);
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        setTimeout(() => resolve(), 800);
      });
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 720;
      canvas.height = video.videoHeight || 1280;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        return null;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      return await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82),
      );
    } catch {
      return null;
    }
  }

  async function uploadFile(file: File) {
    setError("");
    setFileName(file.name);
    if (file.size > MAX_STORY_CLIP_BYTES) {
      setError("Video too large. Each Story clip can be up to 50 MB.");
      return;
    }
    let duration = 0;
    try {
      duration = await readDuration(file);
    } catch {
      setError("Could not read video duration. Try MP4 or MOV.");
      return;
    }
    if (duration > MAX_STORY_CLIP_SECONDS + 0.5) {
      setError("Each Story clip can be up to 90 seconds long.");
      return;
    }

    setBusy(true);
    setProgress(8);
    try {
      const poster = await capturePoster(file);
      setProgress(20);
      const form = new FormData();
      form.append("file", file);
      form.append("durationSec", String(duration));
      if (poster) form.append("poster", poster, "poster.jpg");

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/stories");
        xhr.upload.onprogress = (ev) => {
          if (!ev.lengthComputable) return;
          const pct = 20 + Math.round((ev.loaded / ev.total) * 70);
          setProgress(pct);
        };
        xhr.onload = () => {
          try {
            const json = JSON.parse(xhr.responseText || "{}") as {
              error?: string;
              ok?: boolean;
            };
            if (xhr.status >= 200 && xhr.status < 300 && json.ok) {
              setProgress(100);
              resolve();
            } else {
              reject(new Error(json.error || "Upload failed"));
            }
          } catch {
            reject(new Error("Upload failed"));
          }
        };
        xhr.onerror = () => reject(new Error("Upload failed"));
        xhr.send(form);
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div
        role="dialog"
        aria-labelledby="create-story-title"
        className="w-full max-w-md rounded-xl border border-white/15 bg-[#071428] p-5 text-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="create-story-title" className="font-display text-2xl">
              Create Story
            </h2>
            <p className="mt-2 text-sm text-white/60">
              Show people where you are and what you can access right now.
            </p>
            <p className="mt-2 text-xs text-electric/90">
              Show us the local market.
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
        <p className="mt-4 text-xs leading-relaxed text-white/45">
          {STORY_PRIVACY_NOTICE}
        </p>
        <p className="mt-2 text-[11px] text-white/40">{STORY_FORMAT_HINT}</p>

        <input
          ref={inputRef}
          type="file"
          accept={STORY_VIDEO_ACCEPT}
          capture="environment"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void uploadFile(f);
          }}
        />

        {error ? (
          <p className="mt-4 text-sm text-red-300">{error}</p>
        ) : null}
        {busy ? (
          <div className="mt-4">
            <p className="text-xs text-white/55">
              Uploading{fileName ? ` “${fileName}”` : ""}… {progress}%
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-electric transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="rounded-lg bg-electric px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-white hover:bg-electric-hover"
            >
              Upload Video
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="rounded-lg border border-white/20 px-4 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-white/80 hover:border-white/40"
            >
              Record / Choose from device
            </button>
            <button
              type="button"
              onClick={onClose}
              className="py-2 text-xs uppercase tracking-[0.12em] text-white/45 hover:text-white"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
