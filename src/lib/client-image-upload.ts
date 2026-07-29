"use client";
import {
  ALLOWED_IMAGE_TYPES,
  CONVERTIBLE_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MAX_SOURCE_IMAGE_BYTES,
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

const ACCEPT_LABEL = "JPG, PNG, WebP, or HEIC";

function extensionOf(name: string): string {
  const m = /\.([^.]+)$/.exec(name || "");
  return (m?.[1] || "").toLowerCase();
}

function normalizeMime(type: string): string {
  if (!type) return "";
  if (type === "image/jpg") return "image/jpeg";
  return type.toLowerCase();
}

function guessMimeFromName(name: string): string {
  const ext = extensionOf(name);
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "heic") return "image/heic";
  if (ext === "heif") return "image/heif";
  return "";
}

export function resolveImageMime(file: File): string {
  return normalizeMime(file.type) || guessMimeFromName(file.name);
}

export function validateImageFileClient(file: File): string | null {
  if (!file || file.size <= 0) return "That file looks empty. Please choose another photo.";
  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    return "Image is too large. Please choose a photo under 30 MB.";
  }
  const type = resolveImageMime(file);
  // Some mobile browsers leave type empty — allow if we can guess, or try decode later.
  if (
    type &&
    !ALLOWED_IMAGE_TYPES.has(type) &&
    !CONVERTIBLE_IMAGE_TYPES.has(type)
  ) {
    return `Unsupported image type. Use ${ACCEPT_LABEL}.`;
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

async function loadBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    // Fallback for browsers that reject HEIC / odd MIME via createImageBitmap.
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () =>
          reject(
            new Error(
              `Could not read this photo. Try saving it as JPG or PNG, then upload again.`,
            ),
          );
        el.src = url;
      });
      return await createImageBitmap(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function canvasToFile(
  canvas: HTMLCanvasElement,
  baseName: string,
  quality: number,
): Promise<File> {
  const blob: Blob | null = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/webp", quality);
  });

  let out = blob;
  if (!out || out.size === 0) {
    out = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
    });
  }
  if (!out) throw new Error("Could not prepare image for upload.");

  // Keep shrinking until under upload limit.
  let q = quality;
  while (out.size > MAX_IMAGE_BYTES && q > 0.45) {
    q -= 0.1;
    const smaller: Blob | null = await new Promise((resolve) => {
      canvas.toBlob(
        (b) => resolve(b),
        out!.type === "image/webp" ? "image/webp" : "image/jpeg",
        q,
      );
    });
    if (!smaller || smaller.size === 0) break;
    out = smaller;
  }

  if (out.size > MAX_IMAGE_BYTES) {
    throw new Error("Image is still too large after compression. Try a smaller photo.");
  }

  const ext = out.type === "image/webp" ? "webp" : "jpg";
  const base = baseName.replace(/\.[^.]+$/, "") || "image";
  return new File([out], `${base}.${ext}`, { type: out.type });
}

/**
 * Decode HEIC/HEIF (and empty-type mobile photos) into a standard JPEG/WebP File.
 * No-op when the file is already an allowed upload type.
 */
export async function normalizeImageForUpload(file: File): Promise<File> {
  const type = resolveImageMime(file);
  if (ALLOWED_IMAGE_TYPES.has(type) && file.type) {
    return file;
  }

  const bitmap = await loadBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not process this photo.");
    ctx.drawImage(bitmap, 0, 0);
    return await canvasToFile(canvas, file.name || "photo.jpg", 0.9);
  } finally {
    bitmap.close();
  }
}

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
  const quality = Math.min(1, Math.max(0.5, opts.quality ?? 0.85));

  const normalized = await normalizeImageForUpload(file);
  const bitmap = await loadBitmap(normalized);
  const imgW = bitmap.width;
  const imgH = bitmap.height;
  const cover = Math.max(outputSize / imgW, outputSize / imgH);
  const scale = cover * zoom;

  const displayedW = imgW * scale;
  const displayedH = imgH * scale;
  let dx = (outputSize - displayedW) / 2 + opts.offsetX;
  let dy = (outputSize - displayedH) / 2 + opts.offsetY;

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

  const base = (file.name || "image").replace(/\.[^.]+$/, "") || "image";
  return canvasToFile(canvas, `${base}-square`, quality);
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

  const normalized = await normalizeImageForUpload(file);
  const bitmap = await loadBitmap(normalized);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return normalized.size <= MAX_IMAGE_BYTES ? normalized : file;
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return canvasToFile(canvas, normalized.name || file.name || "image", quality);
}

/**
 * Upload a profile/stock image.
 * Compresses first so mobile camera / HEIC photos work worldwide.
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
  let compressed: File;
  try {
    compressed = await compressImageFile(opts.file, kind);
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? err.message
        : "Could not process this photo. Try JPG or PNG.",
    );
  }

  if (compressed.size > MAX_IMAGE_BYTES) {
    throw new Error("Image is still too large after compression. Try a smaller photo.");
  }

  const previewUrl = createLocalPreview(compressed);
  onProgress?.({ percent: 30, stage: "uploading" });

  return await new Promise<ProfileUploadResult>((resolve, reject) => {
    const form = new FormData();
    form.append("file", compressed, compressed.name || "photo.jpg");
    form.append("folder", folder);
    if (replaceUrl) form.append("replaceUrl", replaceUrl);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.responseType = "json";
    xhr.timeout = 120_000;

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const ratio = event.total > 0 ? event.loaded / event.total : 0;
      const pct = 30 + Math.round(ratio * 65);
      onProgress?.({ percent: Math.min(95, pct), stage: "uploading" });
    };

    xhr.onerror = () => {
      URL.revokeObjectURL(previewUrl);
      reject(new Error("Upload failed. Check your connection and try again."));
    };

    xhr.ontimeout = () => {
      URL.revokeObjectURL(previewUrl);
      reject(new Error("Upload timed out. Please retry on a stronger connection."));
    };

    xhr.onload = () => {
      const data = (xhr.response || {}) as { error?: string; url?: string };
      if (xhr.status < 200 || xhr.status >= 300 || !data.url) {
        URL.revokeObjectURL(previewUrl);
        const msg =
          data.error ||
          (xhr.status === 413
            ? "Image too large. Please try a smaller photo."
            : xhr.status === 401
              ? "Sign in required"
              : "Upload failed. Please try again.");
        reject(new Error(msg));
        return;
      }
      onProgress?.({ percent: 100, stage: "done" });
      resolve({ url: data.url, previewUrl });
    };

    xhr.send(form);
  });
}
