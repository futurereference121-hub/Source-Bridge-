import { createHash, randomBytes } from "crypto";
import { mkdir, writeFile, unlink } from "fs/promises";
import path from "path";

/**
 * Image storage abstraction.
 * Default: local filesystem under public/uploads/ (gitignored).
 * Swap for S3 / Cloudinary / Vercel Blob by implementing the same interface.
 *
 * Env (future providers):
 *   STORAGE_PROVIDER=local|s3|cloudinary|vercel-blob
 *   S3_BUCKET / AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
 *   CLOUDINARY_URL
 *   BLOB_READ_WRITE_TOKEN
 */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export type StoredImage = {
  /** Public URL path, e.g. /uploads/abc.webp */
  url: string;
  /** Relative path under public/, e.g. uploads/abc.webp */
  relativePath: string;
  contentType: string;
  size: number;
};

export type StorageResult =
  | { ok: true; image: StoredImage }
  | { ok: false; error: string };

function getProvider(): string {
  return (process.env.STORAGE_PROVIDER || "local").toLowerCase();
}

function extensionFor(type: string): string {
  switch (type) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

export function validateImageFile(file: {
  type: string;
  size: number;
}): string | null {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return "Unsupported image type. Use JPEG, PNG, WebP, or GIF.";
  }
  if (file.size <= 0) return "Empty file.";
  if (file.size > MAX_IMAGE_BYTES) {
    return "Image must be 5 MB or smaller.";
  }
  return null;
}

async function saveLocal(
  buffer: Buffer,
  contentType: string,
  folder: string,
): Promise<StorageResult> {
  const ext = extensionFor(contentType);
  const name = `${Date.now()}-${randomBytes(8).toString("hex")}.${ext}`;
  const relativeDir = path.join("uploads", folder);
  const absoluteDir = path.join(process.cwd(), "public", relativeDir);
  await mkdir(absoluteDir, { recursive: true });
  const relativePath = path.join(relativeDir, name).replace(/\\/g, "/");
  const absolutePath = path.join(process.cwd(), "public", relativePath);
  await writeFile(absolutePath, buffer);
  return {
    ok: true,
    image: {
      url: `/${relativePath}`,
      relativePath,
      contentType,
      size: buffer.length,
    },
  };
}

export async function storeImage(
  file: File | Blob,
  opts: { folder?: string } = {},
): Promise<StorageResult> {
  const contentType = file.type || "application/octet-stream";
  const size = file.size;
  const validationError = validateImageFile({ type: contentType, size });
  if (validationError) return { ok: false, error: validationError };

  const buffer = Buffer.from(await file.arrayBuffer());
  const folder = opts.folder || "misc";
  const provider = getProvider();

  if (provider === "local") {
    return saveLocal(buffer, contentType, folder);
  }

  // Structured for later providers — fall back to local with a warning.
  console.warn(
    `[storage] Provider "${provider}" not implemented; using local filesystem.`,
  );
  return saveLocal(buffer, contentType, folder);
}

export async function deleteStoredImage(urlOrPath: string): Promise<void> {
  if (!urlOrPath) return;
  // Only delete local uploads we own
  const cleaned = urlOrPath.replace(/^\//, "");
  if (!cleaned.startsWith("uploads/")) return;
  const absolute = path.join(process.cwd(), "public", cleaned);
  try {
    await unlink(absolute);
  } catch {
    // ignore missing files
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createRawToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}
