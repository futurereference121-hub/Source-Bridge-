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
