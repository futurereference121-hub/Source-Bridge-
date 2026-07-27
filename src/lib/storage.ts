import { createHash, randomBytes } from "crypto";
import { del, put } from "@vercel/blob";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
} from "@/lib/storage-constants";

export { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "@/lib/storage-constants";

/**
 * Image storage — Vercel Blob for production, with optional local fallback for
 * offline/dev when BLOB_READ_WRITE_TOKEN is absent.
 *
 * Env:
 *   BLOB_READ_WRITE_TOKEN — required for Vercel Blob (also auto-injected by Vercel)
 *   STORAGE_PROVIDER=vercel-blob|local — defaults to vercel-blob when token present
 */

export const PROFILE_IMAGE_FOLDERS = ["avatars", "covers"] as const;
export type ProfileImageFolder = (typeof PROFILE_IMAGE_FOLDERS)[number];
export type UploadFolder = ProfileImageFolder | "stock" | "misc";

export type StoredImage = {
  /** Public absolute URL (Blob) or local path */
  url: string;
  contentType: string;
  size: number;
  pathname?: string;
};

export type StorageResult =
  | { ok: true; image: StoredImage }
  | { ok: false; error: string };

function getProvider(): "vercel-blob" | "local" {
  const explicit = (process.env.STORAGE_PROVIDER || "").toLowerCase();
  if (explicit === "local") return "local";
  if (explicit === "vercel-blob") return "vercel-blob";
  return process.env.BLOB_READ_WRITE_TOKEN ? "vercel-blob" : "local";
}

export function extensionFor(type: string): string {
  switch (type) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return "bin";
  }
}

export function validateImageFile(file: {
  type: string;
  size: number;
}): string | null {
  const type = file.type === "image/jpg" ? "image/jpeg" : file.type;
  if (!ALLOWED_IMAGE_TYPES.has(type) && !ALLOWED_IMAGE_TYPES.has(file.type)) {
    return "Unsupported image type. Use JPG, JPEG, PNG, or WebP.";
  }
  if (file.size <= 0) return "Empty file.";
  if (file.size > MAX_IMAGE_BYTES) {
    return "Image must be 5 MB or smaller.";
  }
  return null;
}

function isUploadFolder(value: string): value is UploadFolder {
  return ["avatars", "covers", "stock", "misc"].includes(value);
}

export function normalizeUploadFolder(raw: unknown): UploadFolder {
  return typeof raw === "string" && isUploadFolder(raw) ? raw : "misc";
}

function isOurBlobUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return (
      host.endsWith(".public.blob.vercel-storage.com") ||
      host.endsWith(".blob.vercel-storage.com")
    );
  } catch {
    return false;
  }
}

/** True when pathname is scoped under this user's upload prefix. */
export function pathnameBelongsToUser(
  pathname: string,
  userId: string,
): boolean {
  const clean = pathname.replace(/^\//, "");
  return (
    clean.startsWith(`avatars/${userId}/`) ||
    clean.startsWith(`covers/${userId}/`) ||
    clean.startsWith(`stock/${userId}/`) ||
    clean.startsWith(`misc/${userId}/`)
  );
}

export function blobPathForUser(
  userId: string,
  folder: UploadFolder,
  contentType: string,
): string {
  const ext = extensionFor(contentType);
  const name = `${Date.now()}-${randomBytes(8).toString("hex")}.${ext}`;
  return `${folder}/${userId}/${name}`;
}

async function saveToBlob(
  buffer: Buffer,
  contentType: string,
  pathname: string,
): Promise<StorageResult> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return {
      ok: false,
      error: "BLOB_READ_WRITE_TOKEN is not configured",
    };
  }
  const blob = await put(pathname, buffer, {
    access: "public",
    contentType,
    token: process.env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: false,
  });
  return {
    ok: true,
    image: {
      url: blob.url,
      pathname: blob.pathname,
      contentType,
      size: buffer.length,
    },
  };
}

async function saveLocalDev(
  buffer: Buffer,
  contentType: string,
  pathname: string,
): Promise<StorageResult> {
  const { mkdir, writeFile } = await import("fs/promises");
  const path = await import("path");
  const absolutePath = path.join(process.cwd(), "public", "uploads", pathname);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, buffer);
  const url = `/uploads/${pathname.replace(/\\/g, "/")}`;
  return {
    ok: true,
    image: {
      url,
      pathname: `uploads/${pathname.replace(/\\/g, "/")}`,
      contentType,
      size: buffer.length,
    },
  };
}

export async function storeImageForUser(
  file: File | Blob,
  opts: { userId: string; folder?: UploadFolder },
): Promise<StorageResult> {
  const contentType = file.type || "application/octet-stream";
  const size = file.size;
  const validationError = validateImageFile({ type: contentType, size });
  if (validationError) return { ok: false, error: validationError };

  const folder = opts.folder || "misc";
  const pathname = blobPathForUser(opts.userId, folder, contentType);
  const buffer = Buffer.from(await file.arrayBuffer());
  const provider = getProvider();

  if (provider === "vercel-blob") {
    return saveToBlob(buffer, contentType, pathname);
  }

  console.warn(
    "[storage] Using local filesystem fallback (set BLOB_READ_WRITE_TOKEN for Vercel Blob).",
  );
  return saveLocalDev(buffer, contentType, pathname);
}

/**
 * Delete a previously stored image if it belongs to this user.
 * No-op for placeholders, external URLs, or other users' paths.
 */
export async function deleteStoredImageForUser(
  urlOrPath: string | null | undefined,
  userId: string,
): Promise<void> {
  if (!urlOrPath || !userId) return;

  if (isOurBlobUrl(urlOrPath)) {
    try {
      const { pathname } = new URL(urlOrPath);
      const clean = pathname.replace(/^\//, "");
      if (!pathnameBelongsToUser(clean, userId)) return;
      if (!process.env.BLOB_READ_WRITE_TOKEN) return;
      await del(urlOrPath, { token: process.env.BLOB_READ_WRITE_TOKEN });
    } catch {
      // ignore delete failures
    }
    return;
  }

  const cleaned = urlOrPath.replace(/^\//, "");
  if (!cleaned.startsWith("uploads/")) return;
  const withoutPrefix = cleaned.slice("uploads/".length);
  if (!pathnameBelongsToUser(withoutPrefix, userId)) return;
  try {
    const { unlink } = await import("fs/promises");
    const path = await import("path");
    await unlink(path.join(process.cwd(), "public", cleaned));
  } catch {
    // ignore
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createRawToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}
