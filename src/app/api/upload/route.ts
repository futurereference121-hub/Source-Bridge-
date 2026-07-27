import { getSessionUser } from "@/lib/auth";
import {
  deleteStoredImageForUser,
  normalizeUploadFolder,
  storeImageForUser,
  validateImageFile,
} from "@/lib/storage";
import { jsonError } from "@/lib/validation";

/**
 * Profile / stock image uploads.
 * Uses server-side `put()` so Vercel-connected Blob stores can rely on
 * BLOB_STORE_ID + VERCEL_OIDC_TOKEN in production without requiring
 * BLOB_READ_WRITE_TOKEN for browser token exchange.
 */
export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return jsonError("Sign in required", 401);

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
    });
  } catch (err) {
    console.error("[upload]", err);
    return jsonError("Upload failed", 500);
  }
}
