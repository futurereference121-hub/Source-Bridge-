import { createHash, randomBytes } from "crypto";
import { del, put } from "@vercel/blob";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
} from "@/lib/storage-constants";

export { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "@/lib/storage-constants";

/**
 * Image storage — Vercel Blob in production, with optional local fallback for
 * offline/dev when Blob credentials are unavailable.
 *
 * Public store env:
 *   BLOB_STORE_ID + VERCEL_OIDC_TOKEN (auto on connected Vercel project)
 *   BLOB_READ_WRITE_TOKEN (optional static token)
 *
 * Private store env (identity documents — prefer Vercel’s PRIVATE_BLOB_* names):
 *   PRIVATE_BLOB_READ_WRITE_TOKEN
 *   PRIVATE_BLOB_STORE_ID
 *   PRIVATE_BLOB_WEBHOOK_PUBLIC_KEY (unused by this app; reserved by Vercel)
 * Legacy alias still accepted: BLOB_PRIVATE_READ_WRITE_TOKEN
 *
 *   STORAGE_PROVIDER=vercel-blob|local
 */

export const PROFILE_IMAGE_FOLDERS = ["avatars", "covers"] as const;
export type ProfileImageFolder = (typeof PROFILE_IMAGE_FOLDERS)[number];
export type UploadFolder = ProfileImageFolder | "stock" | "misc" | "verification";

export type StoredImage = {
  /** Absolute URL (Blob) or local path — private verification URLs must not be exposed publicly */
  url: string;
  contentType: string;
  size: number;
  pathname?: string;
  access?: "public" | "private";
};

export type StorageResult =
  | { ok: true; image: StoredImage }
  | {
      ok: false;
      /** Detailed error for logs/server-side diagnostics — may include setup instructions. */
      error: string;
      /** Safe message for the client response — never mentions env vars or infra setup. */
      clientError?: string;
    };

function getProvider(): "vercel-blob" | "local" {
  const explicit = (process.env.STORAGE_PROVIDER || "").toLowerCase();
  if (explicit === "local") return "local";
  if (explicit === "vercel-blob") return "vercel-blob";
  return process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN
    ? "vercel-blob"
    : "local";
}

/** Public listing/profile Blob token. */
function getPublicBlobToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN || undefined;
}

/**
 * Private Blob store token. Prefer Vercel’s connected private-store names;
 * fall back to the older BLOB_PRIVATE_* alias if present.
 */
function getPrivateBlobToken(): string | undefined {
  return (
    process.env.PRIVATE_BLOB_READ_WRITE_TOKEN ||
    process.env.BLOB_PRIVATE_READ_WRITE_TOKEN ||
    undefined
  );
}

function getPrivateBlobStoreId(): string | undefined {
  return (
    process.env.PRIVATE_BLOB_STORE_ID ||
    process.env.BLOB_PRIVATE_STORE_ID ||
    undefined
  );
}

/** True when a private Blob store is usable for identity documents. */
export function isPrivateBlobConfigured(): boolean {
  return Boolean(getPrivateBlobToken() || getPrivateBlobStoreId());
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
  // Empty MIME is allowed — storeImageForUser sniffs magic bytes.
  if (
    type &&
    !ALLOWED_IMAGE_TYPES.has(type) &&
    !ALLOWED_IMAGE_TYPES.has(file.type)
  ) {
    return "Unsupported image type. Use JPG, JPEG, PNG, or WebP.";
  }
  if (file.size <= 0) return "Empty file.";
  if (file.size > MAX_IMAGE_BYTES) {
    return "Image too large. Please choose a smaller photo.";
  }
  return null;
}

export function detectImageMimeType(bytes: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

function isUploadFolder(value: string): value is UploadFolder {
  return ["avatars", "covers", "stock", "misc", "verification"].includes(value);
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
    clean.startsWith(`misc/${userId}/`) ||
    clean.startsWith(`verification/${userId}/`)
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
  access: "public" | "private" = "public",
): Promise<StorageResult> {
  const token =
    access === "private" ? getPrivateBlobToken() : getPublicBlobToken();
  const storeConfigured =
    access === "private"
      ? Boolean(getPrivateBlobStoreId() || token)
      : Boolean(process.env.BLOB_STORE_ID || token);
  if (!storeConfigured) {
    return {
      ok: false,
      error: "Vercel Blob is not configured",
    };
  }
  const blob = await put(pathname, buffer, {
    access,
    contentType,
    addRandomSuffix: false,
    ...(token
      ? { token }
      : {}),
  });
  return {
    ok: true,
    image: {
      url: blob.url,
      pathname: blob.pathname,
      contentType,
      size: buffer.length,
      access,
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
  opts: {
    userId: string;
    folder?: UploadFolder;
    access?: "public" | "private";
  },
): Promise<StorageResult> {
  const size = file.size;
  const declaredType = file.type || "";
  const softValidation = validateImageFile({
    type: declaredType || "image/jpeg",
    size,
  });
  // Allow empty MIME through so we can sniff; still reject oversized files early.
  if (size <= 0) return { ok: false, error: "Empty file.", clientError: "Empty file." };
  if (size > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error: softValidation || "Image too large",
      clientError: "Image too large. Please choose a smaller photo.",
    };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const detected = detectImageMimeType(buffer);
  const contentType =
    detected ||
    (declaredType === "image/jpg" ? "image/jpeg" : declaredType) ||
    "";

  if (!contentType || !ALLOWED_IMAGE_TYPES.has(contentType)) {
    console.error("[storage] unsupported image bytes", {
      declaredType: declaredType || "(empty)",
      size,
      detected: detected || null,
    });
    return {
      ok: false,
      error: "Unsupported image type",
      clientError: "Unsupported image type. Use JPG, JPEG, PNG, or WebP.",
    };
  }

  const folder = opts.folder || "misc";
  const access =
    opts.access || (folder === "verification" ? "private" : "public");
  const pathname = blobPathForUser(opts.userId, folder, contentType);
  const provider = getProvider();

  if (provider === "vercel-blob") {
    if (access === "private" && !isPrivateBlobConfigured()) {
      return {
        ok: false,
        error:
          "Private Blob storage is not configured. Set PRIVATE_BLOB_READ_WRITE_TOKEN.",
        clientError:
          "Identity verification is temporarily unavailable. Please try again later.",
      };
    }
    try {
      return await saveToBlob(buffer, contentType, pathname, access);
    } catch (err) {
      console.error("[storage] blob put failed", {
        folder,
        userId: opts.userId,
        size,
        contentType,
        message: err instanceof Error ? err.message : "unknown",
      });
      return {
        ok: false,
        error: "Blob upload failed",
        clientError: "Upload failed. Please try again.",
      };
    }
  }

  console.warn(
    "[storage] Using local filesystem fallback (set Vercel Blob env vars for Blob storage).",
  );
  // Verification must never land in public/ — keep under private/.
  if (access === "private" || folder === "verification") {
    return saveLocalPrivate(buffer, contentType, pathname);
  }
  return saveLocalDev(buffer, contentType, pathname);
}

/** Stores a verification image only in private Blob storage or local private/. */
export async function storePrivateVerificationImage(file: File | Blob, userId: string): Promise<StorageResult> {
  const validationError = validateImageFile({ type: file.type, size: file.size });
  if (validationError) return { ok: false, error: validationError };
  const buffer = Buffer.from(await file.arrayBuffer());
  const detected = detectImageMimeType(buffer);
  if (!detected) {
    return {
      ok: false,
      error: "The uploaded file is not a valid JPEG, PNG, or WebP image.",
    };
  }
  const pathname = `verification/${userId}/${Date.now()}-${randomBytes(8).toString("hex")}.${extensionFor(detected)}`;

  // Prefer dedicated private Blob store. Never write ID documents to the public store.
  if (isPrivateBlobConfigured()) {
    return saveToBlob(buffer, detected, pathname, "private");
  }

  // Local/dev (or non-Vercel) fallback: opaque private:// paths under /private.
  // On Vercel serverless FS is ephemeral — require a private Blob store there.
  if (process.env.VERCEL) {
    const detail =
      "Private verification storage is not configured. Create a Private Vercel Blob store and set PRIVATE_BLOB_READ_WRITE_TOKEN (and PRIVATE_BLOB_STORE_ID when provided by Vercel).";
    console.error(`[storage] storePrivateVerificationImage: ${detail}`);
    return {
      ok: false,
      error: detail,
      clientError:
        "Identity verification is temporarily unavailable. Please try again later.",
    };
  }

  return saveLocalPrivate(buffer, detected, pathname);
}

/** Reads a private local reference or a private Blob using the private token. */
export async function readPrivateStoredBytes(urlOrPath: string): Promise<Buffer | null> {
  if (!urlOrPath) return null;

  if (urlOrPath.startsWith("private://")) {
    const path = await import("path");
    const { readFile } = await import("fs/promises");
    try {
      return await readFile(path.join(process.cwd(), "private", urlOrPath.slice("private://".length)));
    } catch (err) {
      console.error("[storage] readPrivateStoredBytes local read failed:", err);
      return null;
    }
  }

  // Vercel private Blob URL — requires Authorization: Bearer <private-token>
  const privateToken = getPrivateBlobToken();
  if (!privateToken) {
    console.error("[storage] readPrivateStoredBytes: PRIVATE_BLOB_READ_WRITE_TOKEN is not set — cannot read private Blob documents");
    return null;
  }
  try {
    const response = await fetch(urlOrPath, {
      headers: { Authorization: `Bearer ${privateToken}` },
      cache: "no-store",
      // 15-second timeout so a slow/hung Blob request doesn't block the admin UI
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.error("[storage] readPrivateStoredBytes: Blob fetch returned", response.status, "for URL prefix", urlOrPath.slice(0, 60));
      return null;
    }
    return Buffer.from(await response.arrayBuffer());
  } catch (err) {
    console.error("[storage] readPrivateStoredBytes: fetch error:", err);
    return null;
  }
}

async function saveLocalPrivate(
  buffer: Buffer,
  contentType: string,
  pathname: string,
): Promise<StorageResult> {
  const { mkdir, writeFile } = await import("fs/promises");
  const path = await import("path");
  const absolutePath = path.join(process.cwd(), "private", pathname);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, buffer);
  // Opaque local reference — served only via authenticated verification document API.
  const url = `private://${pathname.replace(/\\/g, "/")}`;
  return {
    ok: true,
    image: {
      url,
      pathname: pathname.replace(/\\/g, "/"),
      contentType,
      size: buffer.length,
      access: "private",
    },
  };
}

/**
 * Delete a previously stored image if it belongs to this user.
 * No-op (returns true) for placeholders, external URLs, or other users'
 * paths. Returns false only when an actual delete attempt for an owned
 * asset threw — callers doing bulk/critical cleanup (e.g. account
 * deletion) can queue a StorageCleanupJob retry on false.
 */
export async function deleteStoredImageForUser(
  urlOrPath: string | null | undefined,
  userId: string,
): Promise<boolean> {
  if (!urlOrPath || !userId) return true;

  if (urlOrPath.startsWith("private://")) {
    const pathname = urlOrPath.slice("private://".length);
    if (!pathnameBelongsToUser(pathname, userId)) return true;
    try {
      const { unlink } = await import("fs/promises");
      const path = await import("path");
      await unlink(path.join(process.cwd(), "private", pathname));
      return true;
    } catch {
      return false;
    }
  }

  if (isOurBlobUrl(urlOrPath)) {
    try {
      const { pathname } = new URL(urlOrPath);
      const clean = pathname.replace(/^\//, "");
      if (!pathnameBelongsToUser(clean, userId)) return true;
      const isVerification = clean.startsWith(`verification/${userId}/`);
      const token = isVerification
        ? getPrivateBlobToken()
        : getPublicBlobToken();
      const delOptions = token ? { token } : undefined;
      await del(urlOrPath, delOptions);
      return true;
    } catch {
      return false;
    }
  }

  const cleaned = urlOrPath.replace(/^\//, "");
  if (!cleaned.startsWith("uploads/")) return true;
  const withoutPrefix = cleaned.slice("uploads/".length);
  if (!pathnameBelongsToUser(withoutPrefix, userId)) return true;
  try {
    const { unlink } = await import("fs/promises");
    const path = await import("path");
    await unlink(path.join(process.cwd(), "public", cleaned));
    return true;
  } catch {
    return false;
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createRawToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}
