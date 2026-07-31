"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppUi } from "@/components/providers/AppProviders";
import {
  MAX_PROFILE_VIDEO_BYTES,
  MAX_PROFILE_VIDEO_SECONDS,
  VIDEO_ACCEPT_ATTR,
  VIDEO_FORMAT_HINT,
} from "@/lib/video-constants";
import type { Member } from "@/lib/types";

type Props = {
  member: Member;
  isOwner: boolean;
};

async function readVideoDuration(file: File): Promise<number> {
  const url = URL.createObjectURL(file);
  try {
    const duration = await new Promise<number>((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        resolve(video.duration);
      };
      video.onerror = () => reject(new Error("Could not read video metadata"));
      video.src = url;
    });
    return duration;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function capturePoster(file: File): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve) => {
      const video = document.createElement("video");
      video.preload = "auto";
      video.muted = true;
      video.playsInline = true;
      video.onloadeddata = () => {
        try {
          video.currentTime = Math.min(0.2, (video.duration || 1) * 0.05);
        } catch {
          resolve(null);
        }
      };
      video.onseeked = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth || 640;
          canvas.height = video.videoHeight || 360;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85);
        } catch {
          resolve(null);
        }
      };
      video.onerror = () => resolve(null);
      video.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ProfileVideoSection({ member, isOwner }: Props) {
  const router = useRouter();
  const { showToast } = useAppUi();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [caption, setCaption] = useState(member.profileVideo?.caption || "");
  const video = member.profileVideo;

  async function onFile(file: File | null) {
    if (!file || busy) return;
    if (file.size > MAX_PROFILE_VIDEO_BYTES) {
      showToast(
        `Video must be under ${Math.round(MAX_PROFILE_VIDEO_BYTES / (1024 * 1024))} MB`,
      );
      return;
    }
    setBusy(true);
    try {
      const duration = await readVideoDuration(file);
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error("Could not read video duration");
      }
      if (duration > MAX_PROFILE_VIDEO_SECONDS + 0.5) {
        throw new Error(
          `Videos must be ${MAX_PROFILE_VIDEO_SECONDS} seconds or shorter`,
        );
      }
      const posterBlob = await capturePoster(file);
      const form = new FormData();
      form.append("file", file);
      form.append("durationSec", String(duration));
      form.append("caption", caption.trim());
      if (posterBlob) {
        form.append("poster", posterBlob, "poster.jpg");
      }
      const res = await fetch("/api/profile/video", {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || "Upload failed");
      }
      showToast("Profile video uploaded successfully.");
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function removeVideo() {
    if (busy) return;
    const ok = window.confirm("Remove your profile video?");
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch("/api/profile/video", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || "Remove failed");
      }
      showToast("Profile video removed.");
      router.refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setBusy(false);
    }
  }

  if (!video?.url && !isOwner) return null;

  return (
    <section className="panel-navy mt-6 rounded-xl px-5 py-6 sm:px-6">
      <h2 className="font-display text-xl text-white sm:text-2xl">
        Where I am at the moment
      </h2>
      {isOwner ? (
        <p className="mt-2 text-sm text-white/50">Show us the local market.</p>
      ) : null}

      {video?.url ? (
        <div className="mt-4 overflow-hidden rounded-lg bg-black/40 ring-1 ring-white/10">
          <video
            key={video.url}
            controls
            playsInline
            preload="metadata"
            poster={video.posterUrl || undefined}
            className="aspect-video w-full bg-black"
            aria-label={video.caption || "Profile location video"}
          >
            <source src={video.url} type={video.mime || "video/mp4"} />
          </video>
          {video.caption ? (
            <p className="border-t border-white/10 px-3 py-2 text-xs text-white/55">
              {video.caption}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-sm text-white/40">
          No location video yet.
        </p>
      )}

      {isOwner ? (
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-xs uppercase tracking-[0.14em] text-white/45">
              Short description (optional)
            </span>
            <input
              className="input-navy mt-1.5 h-11 w-full rounded-lg px-4 text-sm"
              value={caption}
              maxLength={200}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="e.g. Friday market in Dahab"
              disabled={busy}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="inline-flex h-10 items-center rounded-lg bg-electric px-4 text-xs font-medium uppercase tracking-[0.12em] text-white hover:bg-electric-hover disabled:opacity-50"
            >
              {busy ? "Uploading…" : video?.url ? "Replace video" : "Upload video"}
            </button>
            {video?.url ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void removeVideo()}
                className="inline-flex h-10 items-center rounded-lg border border-white/20 px-4 text-xs uppercase tracking-[0.12em] text-white/70 hover:border-white/40 disabled:opacity-50"
              >
                Remove
              </button>
            ) : null}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={VIDEO_ACCEPT_ATTR}
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              void onFile(e.target.files?.[0] || null);
            }}
          />
          <p className="text-[11px] text-white/35">{VIDEO_FORMAT_HINT}</p>
        </div>
      ) : null}
    </section>
  );
}
