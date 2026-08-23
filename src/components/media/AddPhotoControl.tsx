"use client";

import { useRef, useState } from "react";
import { Camera, ImagePlus } from "lucide-react";
import { uploadProfileImageFile } from "@/lib/client-image-upload";
import { IMAGE_ACCEPT_ATTR } from "@/lib/storage-constants";

type Props = {
  userId: string;
  folder?: "misc" | "stock" | "avatars" | "covers";
  disabled?: boolean;
  maxCount?: number;
  urls: string[];
  onChange: (urls: string[]) => void;
  label?: string;
  testId?: string;
};

/**
 * Shared ADD PHOTO control — TAKE A PHOTO / UPLOAD A PHOTO.
 * Never uses Choose File as the primary affordance.
 */
export function AddPhotoControl({
  userId,
  folder = "misc",
  disabled,
  maxCount = 3,
  urls,
  onChange,
  label = "ADD PHOTO",
  testId = "add-photo-control",
}: Props) {
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleFile(file: File | undefined) {
    if (!file || disabled || busy) return;
    if (urls.length >= maxCount) {
      setError(`Maximum ${maxCount} photo${maxCount === 1 ? "" : "s"}`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await uploadProfileImageFile({
        file,
        folder,
        kind: "stock",
        userId,
      });
      onChange([...urls, result.url].slice(0, maxCount));
      URL.revokeObjectURL(result.previewUrl);
      setMenuOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="relative inline-block">
        <button
          type="button"
          disabled={disabled || busy || urls.length >= maxCount}
          onClick={() => setMenuOpen((v) => !v)}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/80 hover:border-electric/40 hover:text-white disabled:opacity-50"
        >
          <ImagePlus size={14} />
          {busy ? "Uploading…" : label}
        </button>
        {menuOpen ? (
          <div className="absolute left-0 z-20 mt-1 min-w-[12rem] overflow-hidden rounded-lg border border-white/15 bg-[#061228] shadow-xl">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs text-white/85 hover:bg-white/5"
              onClick={() => cameraRef.current?.click()}
            >
              <Camera size={14} />
              TAKE A PHOTO
            </button>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs text-white/85 hover:bg-white/5"
              onClick={() => galleryRef.current?.click()}
            >
              <ImagePlus size={14} />
              UPLOAD A PHOTO
            </button>
          </div>
        ) : null}
      </div>
      <input
        ref={cameraRef}
        type="file"
        accept={IMAGE_ACCEPT_ATTR}
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          void handleFile(f);
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept={IMAGE_ACCEPT_ATTR}
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          void handleFile(f);
        }}
      />
      {urls.length ? (
        <div className="flex flex-wrap gap-2">
          {urls.map((url) => (
            <div key={url} className="relative h-16 w-16 overflow-hidden rounded-lg border border-white/15">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-full w-full object-cover" />
              <button
                type="button"
                className="absolute inset-x-0 bottom-0 bg-black/70 py-0.5 text-[9px] uppercase text-white/80"
                onClick={() => onChange(urls.filter((u) => u !== url))}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {error ? <p className="text-xs text-red-300">{error}</p> : null}
    </div>
  );
}
