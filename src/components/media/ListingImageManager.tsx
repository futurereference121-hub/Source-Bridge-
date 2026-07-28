"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { SquareImageCropper } from "@/components/media/SquareImageCropper";
import {
  uploadProfileImageFile,
  validateImageFileClient,
} from "@/lib/client-image-upload";
import { IMAGE_ACCEPT_ATTR } from "@/lib/storage-constants";

type Props = {
  userId: string;
  images: string[];
  onChange: (images: string[]) => void;
  showToast: (message: string) => void;
  maxImages?: number;
  disabled?: boolean;
};

export function ListingImageManager({
  userId,
  images,
  onChange,
  showToast,
  maxImages = 6,
  disabled,
}: Props) {
  const [cropSource, setCropSource] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function onFileSelect(file: File | null) {
    if (!file || busy || disabled) return;
    if (images.length >= maxImages) {
      showToast(`You can upload up to ${maxImages} images`);
      return;
    }
    const err = validateImageFileClient(file);
    if (err) {
      showToast(err);
      return;
    }
    setCropSource(file);
  }

  async function onCropped(file: File) {
    setCropSource(null);
    setBusy(true);
    try {
      const result = await uploadProfileImageFile({
        file,
        folder: "stock",
        kind: "stock",
        userId,
      });
      if (result.previewUrl) URL.revokeObjectURL(result.previewUrl);
      onChange([...images, result.url].slice(0, maxImages));
      showToast("Image uploaded");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  function move(index: number, delta: number) {
    const next = index + delta;
    if (next < 0 || next >= images.length) return;
    const copy = images.slice();
    const [item] = copy.splice(index, 1);
    copy.splice(next, 0, item);
    onChange(copy);
  }

  function setCover(index: number) {
    if (index <= 0) return;
    const copy = images.slice();
    const [item] = copy.splice(index, 1);
    copy.unshift(item);
    onChange(copy);
  }

  function removeAt(index: number) {
    onChange(images.filter((_, i) => i !== index));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || disabled || images.length >= maxImages}
          onClick={() => inputRef.current?.click()}
          className="inline-flex h-10 items-center rounded-lg border border-white/20 px-4 text-xs text-white/70 transition-colors hover:border-electric/50 hover:text-white disabled:opacity-50"
        >
          {busy ? "Uploading…" : "Add image"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={IMAGE_ACCEPT_ATTR}
          className="hidden"
          disabled={busy || disabled}
          onChange={(e) => {
            onFileSelect(e.target.files?.[0] || null);
            e.target.value = "";
          }}
        />
        <p className="text-[11px] text-white/35">
          Square crop · JPG, PNG, or WebP · max 5 MB · {images.length}/{maxImages}
        </p>
      </div>

      {images.length ? (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {images.map((src, i) => (
            <li
              key={`${src}-${i}`}
              className="overflow-hidden rounded-lg border border-white/12 bg-white/[0.03]"
            >
              <div className="relative aspect-square">
                <Image
                  src={src}
                  alt=""
                  fill
                  sizes="160px"
                  unoptimized
                  className="object-cover"
                />
                {i === 0 ? (
                  <span className="absolute left-1.5 top-1.5 rounded bg-electric/90 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
                    Cover
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1 border-t border-white/10 p-1.5">
                {i > 0 ? (
                  <button
                    type="button"
                    disabled={disabled || busy}
                    onClick={() => setCover(i)}
                    className="rounded px-1.5 py-1 text-[10px] uppercase tracking-wide text-electric hover:bg-electric/15 disabled:opacity-50"
                  >
                    Cover
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={disabled || busy || i === 0}
                  onClick={() => move(i, -1)}
                  className="rounded px-1.5 py-1 text-[10px] uppercase tracking-wide text-white/60 hover:bg-white/10 disabled:opacity-30"
                >
                  Up
                </button>
                <button
                  type="button"
                  disabled={disabled || busy || i === images.length - 1}
                  onClick={() => move(i, 1)}
                  className="rounded px-1.5 py-1 text-[10px] uppercase tracking-wide text-white/60 hover:bg-white/10 disabled:opacity-30"
                >
                  Down
                </button>
                <button
                  type="button"
                  disabled={disabled || busy}
                  onClick={() => removeAt(i)}
                  className="ml-auto rounded px-1.5 py-1 text-[10px] uppercase tracking-wide text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-white/40">No images yet.</p>
      )}

      {cropSource ? (
        <SquareImageCropper
          source={cropSource}
          open
          title="Crop listing image"
          outputSize={1600}
          onCancel={() => setCropSource(null)}
          onConfirm={onCropped}
        />
      ) : null}
    </div>
  );
}
