import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getSessionUser } from "@/lib/auth";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  blobPathForUser,
  deleteStoredImageForUser,
  normalizeUploadFolder,
  storeImageForUser,
  validateImageFile,
} from "@/lib/storage";
import { jsonError } from "@/lib/validation";

/**
 * Profile / stock image uploads.
 *
 * - JSON body: Vercel Blob client upload handshake (`@vercel/blob/client`).
 * - multipart FormData: server-side put (fallback / stock / local dev).
 *
 * All uploads require an authenticated session and are namespaced by userId.
 */
export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return jsonError("Sign in required", 401);

    const contentType = req.headers.get("content-type") || "";

    // Client-side direct-to-Blob upload flow
    if (contentType.includes("application/json")) {
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        return jsonError(
          "Blob storage is not configured. Set BLOB_READ_WRITE_TOKEN.",
          503,
        );
      }

      const body = (await req.json()) as HandleUploadBody & {
        folder?: string;
        replaceUrl?: string;
      };

      // folder/replaceUrl may arrive on clientPayload for type "upload"
      const jsonResponse = await handleUpload({
        body,
        request: req,
        onBeforeGenerateToken: async (pathname, clientPayload) => {
          let folder = normalizeUploadFolder("avatars");
          let replaceUrl = "";
          if (clientPayload) {
            try {
              const parsed = JSON.parse(clientPayload) as {
                folder?: string;
                replaceUrl?: string;
              };
              folder = normalizeUploadFolder(parsed.folder);
              replaceUrl =
                typeof parsed.replaceUrl === "string" ? parsed.replaceUrl : "";
            } catch {
              /* ignore */
            }
          }

          // Enforce user-scoped path prefix even if client sends something else
          const expectedPrefix = `${folder}/${user.id}/`;
          if (!pathname.startsWith(expectedPrefix)) {
            throw new Error("Invalid upload path");
          }

          // Stash replaceUrl for onUploadCompleted via token payload extras
          void replaceUrl;

          return {
            allowedContentTypes: Array.from(ALLOWED_IMAGE_TYPES),
            maximumSizeInBytes: MAX_IMAGE_BYTES,
            tokenPayload: JSON.stringify({
              userId: user.id,
              folder,
              replaceUrl,
            }),
            addRandomSuffix: false,
          };
        },
        onUploadCompleted: async ({ blob, tokenPayload }) => {
          if (!tokenPayload) return;
          try {
            const meta = JSON.parse(tokenPayload) as {
              userId?: string;
              replaceUrl?: string;
            };
            if (meta.userId !== user.id) return;
            if (meta.replaceUrl && meta.replaceUrl !== blob.url) {
              await deleteStoredImageForUser(meta.replaceUrl, user.id);
            }
          } catch {
            /* ignore */
          }
        },
      });

      return Response.json(jsonResponse);
    }

    // Multipart fallback (local dev / stock / environments without client upload)
    const form = await req.formData();
    const file = form.get("file");
    const folder = normalizeUploadFolder(form.get("folder"));
    const replaceUrlRaw = form.get("replaceUrl");
    const replaceUrl =
      typeof replaceUrlRaw === "string" ? replaceUrlRaw : undefined;

    if (!(file instanceof File)) {
      return jsonError("file is required", 400);
    }

    const validationError = validateImageFile({
      type: file.type,
      size: file.size,
    });
    if (validationError) return jsonError(validationError, 400);

    const result = await storeImageForUser(file, {
      userId: user.id,
      folder,
    });
    if (!result.ok) return jsonError(result.error, 400);

    if (replaceUrl && replaceUrl !== result.image.url) {
      await deleteStoredImageForUser(replaceUrl, user.id);
    }

    return Response.json({
      ok: true,
      url: result.image.url,
      pathname: result.image.pathname,
      pathnameHint: blobPathForUser(user.id, folder, file.type),
    });
  } catch (err) {
    console.error("[upload]", err);
    const message =
      err instanceof Error ? err.message : "Upload failed";
    if (message === "Invalid upload path") {
      return jsonError(message, 400);
    }
    return jsonError("Upload failed", 500);
  }
}
