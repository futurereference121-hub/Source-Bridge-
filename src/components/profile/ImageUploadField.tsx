"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { SquareImageCropper } from "@/components/media/SquareImageCropper";
import {
  createLocalPreview,
  uploadProfileImageFile,
  validateImageFileClient,
  type ProfileUploadProgress,
  type UploadFolder,
} from "@/lib/client-image-upload";
import { IMAGE_ACCEPT_ATTR } from "@/lib/storage-constants";

type Props = {
  label: string;
  folder: UploadFolder;
  kind: "photo" | "cover";
  value: string;
  userId: string;
  variant?: "avatar" | "cover";
  onUploaded: (url: string) => void | Promise<void>;
  showToast: (message: string) => void;
  disabled?: boolean;
};

export function ImageUploadField({
  label,
  folder,
  kind,
  value,
  userId,
  variant = "avatar",
  onUploaded,
  showToast,
  disabled,
}: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState<ProfileUploadProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [cropSource, setCropSource] = useState<File | null>(null);
  const previewRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  function setPreviewUrl(url: string | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = url;
    setPreview(url);
  }

  function onFileSelect(file: File | null) {
    if (!file || busy || disabled) return;
    const err = validateImageFileClient(file);
    if (err) {
      showToast(err);
      return;
    }
    setCropSource(file);
  }

  async function onCropped(file: File) {
    setCropSource(null);
    const local = createLocalPreview(file);
    setPreviewUrl(local);
    setBusy(true);
    setProgress({ percent: 0, stage: "validating" });

    try {
      const result = await uploadProfileImageFile({
        file,
        folder,
        kind,
        userId,
        replaceUrl: value || undefined,
        onProgress: setProgress,
      });
      setPreviewUrl(result.previewUrl);
      await onUploaded(result.url);
      showToast(kind === "photo" ? "Photo uploaded" : "Cover uploaded");
      setProgress({ percent: 100, stage: "done" });
    } catch (e) {
      setPreviewUrl(null);
      showToast(e instanceof Error ? e.message : "Upload failed");
      setProgress(null);
    } finally {
      setBusy(false);
      window.setTimeout(() => setProgress(null), 800);
    }
  }

  const displaySrc = preview || value;
  const isAvatar = variant === "avatar";
  const pct = progress?.percent ?? 0;
  const stageLabel =
    progress?.stage === "compressing"
      ? "Compressing…"
      : progress?.stage === "uploading"
        ? `Uploading ${pct}%`
        : progress?.stage === "validating"
          ? "Checking…"
          : progress?.stage === "done"
            ? "Done"
            : null;

  return (
    <div>
      <p className="text-xs uppercase tracking-[0.14em] text-white/45">{label}</p>
      <div className={`mt-2 ${isAvatar ? "flex items-center gap-3" : ""}`}>
        <div
          className={
            isAvatar
              ? "relative h-16 w-16 overflow-hidden rounded-full border border-white/15 bg-white/5 sm:h-28 sm:w-28 sm:rounded-xl"
              : "relative h-16 w-full overflow-hidden rounded-lg border border-white/15 bg-white/5 sm:h-32"
          }
        >
          {displaySrc ? (
            <Image
              src={displaySrc}
              alt=""
              fill
              sizes={isAvatar ? "112px" : "640px"}
              unoptimized
              className="object-cover"
            />
          ) : null}
          {busy ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/55 px-2">
              <div className="h-1.5 w-[70%] overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-full rounded-full bg-electric transition-all duration-200"
                  style={{ width: `${pct}%` }}
                />
              </div>
              {stageLabel ? (
                <p className="mt-1.5 text-[10px] text-white/80">{stageLabel}</p>
              ) : null}
            </div>
          ) : null}
        </div>
        <label
          className={`cursor-pointer text-sm text-electric hover:underline ${
            isAvatar ? "" : "mt-2 inline-block"
          } ${busy || disabled ? "pointer-events-none opacity-50" : ""}`}
        >
          {busy
            ? stageLabel || "Uploading…"
            : value || preview
              ? "Replace"
              : "Upload"}
          <input
            type="file"
            accept={IMAGE_ACCEPT_ATTR}
            className="hidden"
            disabled={busy || disabled}
            onChange={(e) => {
              onFileSelect(e.target.files?.[0] || null);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {!busy && progress === null ? (
        <p className="mt-1.5 text-[11px] text-white/35">
          JPG, PNG, or WebP · max 5 MB
        </p>
      ) : null}

      {cropSource ? (
        <SquareImageCropper
          source={cropSource}
          open
          title={kind === "cover" ? "Crop cover" : "Crop photo"}
          outputSize={kind === "cover" ? 1280 : 1024}
          onCancel={() => setCropSource(null)}
          onConfirm={onCropped}
        />
      ) : null}
    </div>
  );
}
