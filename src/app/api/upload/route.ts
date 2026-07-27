import { getSessionUser } from "@/lib/auth";
import { storeImage } from "@/lib/storage";
import { jsonError } from "@/lib/validation";

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return jsonError("Sign in required", 401);

    const form = await req.formData();
    const file = form.get("file");
    const folderRaw = form.get("folder");
    const folder =
      typeof folderRaw === "string" &&
      ["avatars", "covers", "stock", "misc"].includes(folderRaw)
        ? folderRaw
        : "misc";

    if (!(file instanceof File)) {
      return jsonError("file is required", 400);
    }

    const result = await storeImage(file, { folder });
    if (!result.ok) return jsonError(result.error, 400);

    return Response.json({ ok: true, url: result.image.url });
  } catch (err) {
    console.error("[upload]", err);
    return jsonError("Upload failed", 500);
  }
}
