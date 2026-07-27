"use client";
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

export type SquareCropOptions = {
  /** 1 = cover the square; >1 zooms in. */
  zoom: number;
  /** Pan from centered cover, in crop-viewport pixels. */
  offsetX: number;
  offsetY: number;
  /** Output edge length in px (default 1024). */
  outputSize?: number;
  /** Encoder quality 0–1 (default 0.85). */
  quality?: number;
};

/**
 * Crop a square region from an image File using zoom + pan,
 * then encode as WebP (JPEG fallback) via canvas.
 */
export async function cropImageToSquare(
  file: File,
  opts: SquareCropOptions,
): Promise<File> {
  const zoom = Math.max(1, opts.zoom);
  const outputSize = Math.max(64, Math.round(opts.outputSize ?? 1024));
  const quality = Math.min(1, Math.max(0.85, opts.quality ?? 0.85));

  const bitmap = await createImageBitmap(file);
  const imgW = bitmap.width;
  const imgH = bitmap.height;
  // Cover scale at zoom=1 for a unit viewport, then apply zoom.
  const cover = Math.max(outputSize / imgW, outputSize / imgH);
  const scale = cover * zoom;

  const displayedW = imgW * scale;
  const displayedH = imgH * scale;
  // Centered top-left, then apply pan (same convention as the cropper UI).
  let dx = (outputSize - displayedW) / 2 + opts.offsetX;
  let dy = (outputSize - displayedH) / 2 + opts.offsetY;

  // Clamp so the square stays covered.
  const minX = outputSize - displayedW;
  const minY = outputSize - displayedH;
  dx = Math.min(0, Math.max(minX, dx));
  dy = Math.min(0, Math.max(minY, dy));

  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Could not crop image.");
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, dx, dy, displayedW, displayedH);
  bitmap.close();

  const blob: Blob | null = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/webp", quality);
  });

  let out = blob;
  if (!out || out.size === 0) {
    out = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
    });
  }
  if (!out) throw new Error("Could not encode cropped image.");

  const ext = out.type === "image/webp" ? "webp" : "jpg";
  const base = file.name.replace(/\.[^.]+$/, "") || "image";
  return new File([out], `${base}-square.${ext}`, { type: out.type });
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

/**
 * Upload a profile/stock image.
 * Sends multipart data through our upload route so the server can store it
 * with Vercel Blob using the project-connected store credentials.
 */
export async function uploadProfileImageFile(opts: {
  file: File;
  folder: UploadFolder;
  kind?: "photo" | "cover" | "stock";
  replaceUrl?: string;
  userId: string;
  onProgress?: (progress: ProfileUploadProgress) => void;
}): Promise<ProfileUploadResult> {
  const { folder, replaceUrl, onProgress } = opts;
  const kind = opts.kind || (folder === "covers" ? "cover" : "photo");

  onProgress?.({ percent: 5, stage: "validating" });
  const validationError = validateImageFileClient(opts.file);
  if (validationError) throw new Error(validationError);

  onProgress?.({ percent: 15, stage: "compressing" });
  const compressed = await compressImageFile(opts.file, kind);
  const stillInvalid = validateImageFileClient(compressed);
  if (stillInvalid) throw new Error(stillInvalid);

  const previewUrl = createLocalPreview(compressed);
  onProgress?.({ percent: 30, stage: "uploading" });

  return await new Promise<ProfileUploadResult>((resolve, reject) => {
    const form = new FormData();
    form.append("file", compressed);
    form.append("folder", folder);
    if (replaceUrl) form.append("replaceUrl", replaceUrl);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.responseType = "json";

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const ratio = event.total > 0 ? event.loaded / event.total : 0;
      const pct = 30 + Math.round(ratio * 65);
      onProgress?.({ percent: Math.min(95, pct), stage: "uploading" });
    };

    xhr.onerror = () => {
      URL.revokeObjectURL(previewUrl);
      reject(new Error("Vercel Blob failed to upload."));
    };

    xhr.onload = () => {
      const data = (xhr.response || {}) as { error?: string; url?: string };
      if (xhr.status < 200 || xhr.status >= 300 || !data.url) {
        URL.revokeObjectURL(previewUrl);
        reject(new Error(data.error || "Vercel Blob failed to upload."));
        return;
      }
      onProgress?.({ percent: 100, stage: "done" });
      resolve({ url: data.url, previewUrl });
    };

    xhr.send(form);
  });
}
