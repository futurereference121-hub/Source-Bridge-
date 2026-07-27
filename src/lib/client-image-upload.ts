"use client";

import { upload } from "@vercel/blob/client";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
} from "@/lib/storage-constants";

export type UploadFolder = "avatars" | "covers" | "stock" | "misc";

export type ProfileUploadProgress = {
  /** 0–100 */
  percent: number;
  stage: "validating" | "compressing" | "uploading" | "done";
};

export type ProfileUploadResult = {
  url: string;
  previewUrl: string;
};

const ACCEPT_LABEL = "JPG, JPEG, PNG, or WebP";

export function validateImageFileClient(file: File): string | null {
  const type = file.type === "image/jpg" ? "image/jpeg" : file.type;
  if (!ALLOWED_IMAGE_TYPES.has(type) && !ALLOWED_IMAGE_TYPES.has(file.type)) {
    return `Unsupported image type. Use ${ACCEPT_LABEL}.`;
  }
  if (file.size <= 0) return "Empty file.";
  if (file.size > MAX_IMAGE_BYTES) {
    return "Image must be 5 MB or smaller.";
  }
  return null;
}

/** Create an object-URL preview (caller must revoke). */
export function createLocalPreview(file: File): string {
  return URL.createObjectURL(file);
}

/**
 * Resize/compress in the browser with canvas.
 * Avatars → max 1024px; covers → max 1920px. Prefer WebP when supported.
 */
export async function compressImageFile(
  file: File,
  kind: "photo" | "cover" | "stock" = "photo",
): Promise<File> {
  const maxEdge = kind === "cover" ? 1920 : kind === "stock" ? 1600 : 1024;
  const quality = kind === "photo" ? 0.82 : 0.85;

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const preferWebp = typeof canvas.toBlob === "function";
  const blob: Blob | null = await new Promise((resolve) => {
    if (!preferWebp) {
      resolve(null);
      return;
    }
    canvas.toBlob((b) => resolve(b), "image/webp", quality);
  });

  let out = blob;
  if (!out || out.size === 0) {
    out = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
    });
  }
  if (!out) return file;

  // Keep original if compression did not shrink (and still under limit)
  if (out.size >= file.size && file.size <= MAX_IMAGE_BYTES) {
    return file;
  }
  if (out.size > MAX_IMAGE_BYTES) {
    throw new Error("Image is still larger than 5 MB after compression.");
  }

  const ext = out.type === "image/webp" ? "webp" : "jpg";
  const base = file.name.replace(/\.[^.]+$/, "") || "image";
  return new File([out], `${base}.${ext}`, { type: out.type });
}

function randomName(ext: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 12)
      : Math.random().toString(36).slice(2, 10);
  return `${Date.now()}-${rand}.${ext}`;
}

/**
 * Upload a profile/stock image.
 * Prefers direct Vercel Blob client upload; falls back to multipart `/api/upload`.
 */
export async function uploadProfileImageFile(opts: {
  file: File;
  folder: UploadFolder;
  kind?: "photo" | "cover" | "stock";
  replaceUrl?: string;
  userId: string;
  onProgress?: (progress: ProfileUploadProgress) => void;
}): Promise<ProfileUploadResult> {
  const { folder, userId, replaceUrl, onProgress } = opts;
  const kind = opts.kind || (folder === "covers" ? "cover" : "photo");

  onProgress?.({ percent: 5, stage: "validating" });
  const validationError = validateImageFileClient(opts.file);
  if (validationError) throw new Error(validationError);

  onProgress?.({ percent: 15, stage: "compressing" });
  const compressed = await compressImageFile(opts.file, kind);
  const stillInvalid = validateImageFileClient(compressed);
  if (stillInvalid) throw new Error(stillInvalid);

  const previewUrl = createLocalPreview(compressed);
  const ext =
    compressed.type === "image/webp"
      ? "webp"
      : compressed.type === "image/png"
        ? "png"
        : "jpg";
  const pathname = `${folder}/${userId}/${randomName(ext)}`;

  try {
    onProgress?.({ percent: 30, stage: "uploading" });
    const blob = await upload(pathname, compressed, {
      access: "public",
      handleUploadUrl: "/api/upload",
      clientPayload: JSON.stringify({ folder, replaceUrl: replaceUrl || "" }),
      multipart: compressed.size > 1_000_000,
      onUploadProgress: (event) => {
        const pct = 30 + Math.round((event.percentage || 0) * 0.65);
        onProgress?.({ percent: Math.min(95, pct), stage: "uploading" });
      },
    });
    onProgress?.({ percent: 100, stage: "done" });
    return { url: blob.url, previewUrl };
  } catch (err) {
    // Fallback: multipart through our API (local / missing Blob client token flow)
    const message = err instanceof Error ? err.message : String(err);
    const shouldFallback =
      message.includes("BLOB_READ_WRITE_TOKEN") ||
      message.includes("Blob storage is not configured") ||
      message.includes("Failed to retrieve") ||
      message.includes("503") ||
      message.includes("fetch");

    if (!shouldFallback) {
      URL.revokeObjectURL(previewUrl);
      throw err instanceof Error ? err : new Error("Upload failed");
    }

    onProgress?.({ percent: 40, stage: "uploading" });
    const form = new FormData();
    form.append("file", compressed);
    form.append("folder", folder);
    if (replaceUrl) form.append("replaceUrl", replaceUrl);

    const res = await fetch("/api/upload", { method: "POST", body: form });
    const data = (await res.json()) as { error?: string; url?: string };
    if (!res.ok || !data.url) {
      URL.revokeObjectURL(previewUrl);
      throw new Error(data.error || "Upload failed");
    }
    onProgress?.({ percent: 100, stage: "done" });
    return { url: data.url, previewUrl };
  }
}
