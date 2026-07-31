"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { SquareImageCropper } from "@/components/media/SquareImageCropper";
import {
  uploadProfileImageFile,
  validateImageFileClient,
} from "@/lib/client-image-upload";
import { IMAGE_ACCEPT_ATTR } from "@/lib/storage-constants";

export type ListingImageSlotStatus =
  | "preparing"
  | "uploading"
  | "uploaded"
  | "failed";

export type ListingImageSlot = {
  /** Stable client id for React keys / in-flight tracking */
  clientId: string;
  /** Permanent Blob URL once uploaded — never a blob: object URL */
  url: string | null;
  /** Local preview only (blob: or permanent); never persisted */
  previewUrl: string | null;
  status: ListingImageSlotStatus;
  progress: number;
  error: string | null;
  /** File kept for Retry */
  file: File | null;
};

type Props = {
  userId: string;
  images: string[];
  onChange: (images: string[]) => void;
  showToast: (message: string) => void;
  maxImages?: number;
  disabled?: boolean;
  onUploadingChange?: (uploading: boolean) => void;
};

function newClientId() {
  return `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function isBlobObjectUrl(url: string | null | undefined) {
  return Boolean(url && url.startsWith("blob:"));
}

function permanentUrlsFromSlots(slots: ListingImageSlot[]): string[] {
  return slots
    .filter((s) => s.status === "uploaded" && s.url && !isBlobObjectUrl(s.url))
    .map((s) => s.url as string);
}

export function ListingImageManager({
  userId,
  images,
  onChange,
  showToast,
  maxImages = 6,
  disabled,
  onUploadingChange,
}: Props) {
  const [slots, setSlots] = useState<ListingImageSlot[]>(() =>
    images.map((url) => ({
      clientId: newClientId(),
      url,
      previewUrl: url,
      status: "uploaded" as const,
      progress: 100,
      error: null,
      file: null,
    })),
  );
  const [cropQueue, setCropQueue] = useState<File[]>([]);
  const [cropSource, setCropSource] = useState<File | string | null>(null);
  const [replaceClientId, setReplaceClientId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  // Sync from parent when saved images change externally (e.g. load listing),
  // but never while uploads are in flight.
  useEffect(() => {
    const busy = slotsRef.current.some(
      (s) => s.status === "preparing" || s.status === "uploading",
    );
    if (busy) return;
    const current = permanentUrlsFromSlots(slotsRef.current);
    const same =
      current.length === images.length &&
      current.every((u, i) => u === images[i]);
    if (same) return;
    setSlots(
      images.map((url) => ({
        clientId: newClientId(),
        url,
        previewUrl: url,
        status: "uploaded" as const,
        progress: 100,
        error: null,
        file: null,
      })),
    );
  }, [images]);

  useEffect(() => {
    const uploading = slots.some(
      (s) => s.status === "preparing" || s.status === "uploading",
    );
    onUploadingChange?.(uploading);
  }, [slots, onUploadingChange]);

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (
        slotsRef.current.some(
          (s) => s.status === "preparing" || s.status === "uploading",
        )
      ) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    if (!cropSource && cropQueue.length) {
      setCropSource(cropQueue[0]);
      setCropQueue((q) => q.slice(1));
    }
  }, [cropSource, cropQueue]);

  function emitUrls(nextSlots: ListingImageSlot[]) {
    onChange(permanentUrlsFromSlots(nextSlots));
  }

  function onFilesSelected(fileList: FileList | null) {
    if (!fileList || disabled) return;
    const remaining =
      maxImages -
      slots.filter((s) => s.status !== "failed").length;
    if (remaining <= 0) {
      showToast(`You can upload up to ${maxImages} images`);
      return;
    }
    const accepted: File[] = [];
    for (const file of Array.from(fileList)) {
      if (accepted.length >= remaining) break;
      const err = validateImageFileClient(file);
      if (err) {
        showToast(err);
        continue;
      }
      accepted.push(file);
    }
    if (!accepted.length) return;
    setCropQueue((q) => [...q, ...accepted]);
  }

  async function uploadSlot(clientId: string, file: File, existingPreview?: string | null) {
    const previewUrl = existingPreview || URL.createObjectURL(file);
    setSlots((prev) => {
      const has = prev.some((s) => s.clientId === clientId);
      const base = has
        ? prev
        : [
            ...prev,
            {
              clientId,
              url: null,
              previewUrl,
              status: "preparing" as const,
              progress: 0,
              error: null,
              file,
            },
          ];
      return base.map((s) =>
        s.clientId === clientId
          ? {
              ...s,
              previewUrl: s.previewUrl || previewUrl,
              file,
              status: "uploading" as const,
              progress: 5,
              error: null,
            }
          : s,
      );
    });

    try {
      const result = await uploadProfileImageFile({
        file,
        folder: "stock",
        kind: "stock",
        userId,
        onProgress: (p) => {
          setSlots((prev) =>
            prev.map((s) =>
              s.clientId === clientId
                ? {
                    ...s,
                    progress: Math.max(5, p.percent),
                    status: "uploading",
                  }
                : s,
            ),
          );
        },
      });
      if (result.previewUrl) URL.revokeObjectURL(result.previewUrl);
      if (previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);

      if (isBlobObjectUrl(result.url)) {
        throw new Error("Upload did not return a permanent image URL");
      }

      setSlots((prev) => {
        const next = prev.map((s) =>
          s.clientId === clientId
            ? {
                ...s,
                url: result.url,
                previewUrl: result.url,
                status: "uploaded" as const,
                progress: 100,
                error: null,
                file: null,
              }
            : s,
        );
        emitUrls(next);
        return next;
      });
      showToast("Image uploaded");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Upload failed";
      setSlots((prev) =>
        prev.map((s) =>
          s.clientId === clientId
            ? {
                ...s,
                status: "failed" as const,
                progress: 0,
                error: message,
              }
            : s,
        ),
      );
      showToast(message);
    }
  }

  function onCropped(file: File) {
    const replacingId = replaceClientId;
    setCropSource(null);
    setReplaceClientId(null);

    if (replacingId) {
      const previewUrl = URL.createObjectURL(file);
      setSlots((prev) =>
        prev.map((s) =>
          s.clientId === replacingId
            ? {
                ...s,
                previewUrl,
                file,
                status: "preparing" as const,
                progress: 0,
                error: null,
                // Keep old permanent url until upload succeeds so failure restores it
              }
            : s,
        ),
      );
      void uploadSlot(replacingId, file, previewUrl);
      return;
    }

    const clientId = newClientId();
    const previewUrl = URL.createObjectURL(file);
    setSlots((prev) => {
      if (prev.filter((s) => s.status !== "failed").length >= maxImages) {
        URL.revokeObjectURL(previewUrl);
        showToast(`You can upload up to ${maxImages} images`);
        return prev;
      }
      return [
        ...prev,
        {
          clientId,
          url: null,
          previewUrl,
          status: "preparing",
          progress: 0,
          error: null,
          file,
        },
      ];
    });
    void uploadSlot(clientId, file, previewUrl);
  }

  function startEditExisting(slot: ListingImageSlot) {
    if (disabled || uploading) return;
    const source = slot.url || slot.previewUrl;
    if (!source || isBlobObjectUrl(source)) {
      if (slot.file) {
        setReplaceClientId(slot.clientId);
        setCropSource(slot.file);
        return;
      }
      showToast("Wait for the image to finish uploading before editing");
      return;
    }
    setReplaceClientId(slot.clientId);
    setCropSource(source);
  }

  function cancelCrop() {
    setCropSource(null);
    setReplaceClientId(null);
  }

  function move(index: number, delta: number) {
    const nextIndex = index + delta;
    setSlots((prev) => {
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const copy = prev.slice();
      const [item] = copy.splice(index, 1);
      copy.splice(nextIndex, 0, item);
      emitUrls(copy);
      return copy;
    });
  }

  function setCover(index: number) {
    if (index <= 0) return;
    setSlots((prev) => {
      const copy = prev.slice();
      const [item] = copy.splice(index, 1);
      copy.unshift(item);
      emitUrls(copy);
      return copy;
    });
  }

  function removeAt(index: number) {
    setSlots((prev) => {
      const target = prev[index];
      if (target?.previewUrl && isBlobObjectUrl(target.previewUrl)) {
        URL.revokeObjectURL(target.previewUrl);
      }
      const copy = prev.filter((_, i) => i !== index);
      emitUrls(copy);
      return copy;
    });
  }

  function retryAt(index: number) {
    const slot = slots[index];
    if (!slot?.file) {
      showToast("Choose the image again to retry");
      return;
    }
    void uploadSlot(slot.clientId, slot.file);
  }

  const activeCount = slots.filter((s) => s.status !== "failed").length;
  const uploading = slots.some(
    (s) => s.status === "preparing" || s.status === "uploading",
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={disabled || uploading || activeCount >= maxImages}
          onClick={() => inputRef.current?.click()}
          className="inline-flex h-10 items-center rounded-lg border border-white/20 px-4 text-xs text-white/70 transition-colors hover:border-electric/50 hover:text-white disabled:opacity-50"
        >
          Add images
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={IMAGE_ACCEPT_ATTR}
          multiple
          className="hidden"
          disabled={disabled || uploading || activeCount >= maxImages}
          onChange={(e) => {
            onFilesSelected(e.target.files);
            e.target.value = "";
          }}
        />
        <p className="text-[11px] text-white/35">
          Square crop · JPG, PNG, or WebP · max 5 MB · {activeCount}/{maxImages}
          {uploading ? " · Uploading…" : ""}
        </p>
      </div>

      {slots.length ? (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {slots.map((slot, i) => {
            const display = slot.previewUrl || slot.url;
            return (
              <li
                key={slot.clientId}
                className="overflow-hidden rounded-lg border border-white/12 bg-white/[0.03]"
              >
                <div className="relative aspect-square">
                  {display ? (
                    <Image
                      src={display}
                      alt=""
                      fill
                      sizes="160px"
                      unoptimized
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-white/40">
                      Preparing…
                    </div>
                  )}
                  {i === 0 && slot.status === "uploaded" ? (
                    <span className="absolute left-1.5 top-1.5 rounded bg-electric/90 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
                      Cover
                    </span>
                  ) : null}
                  {(slot.status === "uploading" ||
                    slot.status === "preparing") && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/55 px-2">
                      <p className="text-[10px] uppercase tracking-wide text-white">
                        {slot.status === "preparing"
                          ? "Preparing"
                          : `Uploading ${slot.progress}%`}
                      </p>
                      <div className="mt-2 h-1 w-full overflow-hidden rounded bg-white/20">
                        <div
                          className="h-full bg-electric transition-all"
                          style={{ width: `${slot.progress}%` }}
                        />
                      </div>
                    </div>
                  )}
                  {slot.status === "failed" ? (
                    <div className="absolute inset-x-0 bottom-0 bg-red-950/90 px-2 py-1.5 text-[10px] text-red-200">
                      {slot.error || "Upload failed"}
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1 border-t border-white/10 p-1.5">
                  {slot.status === "failed" ? (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => retryAt(i)}
                      className="rounded px-1.5 py-1 text-[10px] uppercase tracking-wide text-electric hover:bg-electric/15 disabled:opacity-50"
                    >
                      Retry
                    </button>
                  ) : null}
                  {slot.status === "uploaded" ? (
                    <button
                      type="button"
                      disabled={disabled || uploading}
                      onClick={() => startEditExisting(slot)}
                      className="rounded px-1.5 py-1 text-[10px] uppercase tracking-wide text-electric hover:bg-electric/15 disabled:opacity-50"
                    >
                      Edit
                    </button>
                  ) : null}
                  {i > 0 && slot.status === "uploaded" ? (
                    <button
                      type="button"
                      disabled={disabled || uploading}
                      onClick={() => setCover(i)}
                      className="rounded px-1.5 py-1 text-[10px] uppercase tracking-wide text-electric hover:bg-electric/15 disabled:opacity-50"
                    >
                      Cover
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={disabled || uploading || i === 0}
                    onClick={() => move(i, -1)}
                    className="rounded px-1.5 py-1 text-[10px] uppercase tracking-wide text-white/60 hover:bg-white/10 disabled:opacity-30"
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    disabled={
                      disabled || uploading || i === slots.length - 1
                    }
                    onClick={() => move(i, 1)}
                    className="rounded px-1.5 py-1 text-[10px] uppercase tracking-wide text-white/60 hover:bg-white/10 disabled:opacity-30"
                  >
                    Down
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => removeAt(i)}
                    className="ml-auto rounded px-1.5 py-1 text-[10px] uppercase tracking-wide text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-50"
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-white/40">No images yet.</p>
      )}

      {cropSource ? (
        <SquareImageCropper
          source={cropSource}
          open
          title={replaceClientId ? "Edit listing image" : "Crop listing image"}
          outputSize={1600}
          onCancel={cancelCrop}
          onConfirm={onCropped}
        />
      ) : null}
    </div>
  );
}
