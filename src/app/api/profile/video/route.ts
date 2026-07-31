import { NextRequest } from "next/server";
import { put, del } from "@vercel/blob";
import { randomBytes } from "crypto";
import { requireSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/validation";
import {
  ALLOWED_VIDEO_TYPES,
  MAX_PROFILE_VIDEO_BYTES,
  MAX_PROFILE_VIDEO_SECONDS,
} from "@/lib/video-constants";

function extForMime(mime: string) {
  if (mime === "video/webm") return "webm";
  if (mime === "video/quicktime") return "mov";
  return "mp4";
}

export async function GET() {
  try {
    const user = await requireSessionUser();
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        profileVideoUrl: true,
        profileVideoPosterUrl: true,
        profileVideoMime: true,
        profileVideoDurationSec: true,
        profileVideoSizeBytes: true,
        profileVideoCaption: true,
        profileVideoUpdatedAt: true,
      },
    });
    if (!row.profileVideoUrl) {
      return Response.json({ video: null });
    }
    return Response.json({
      video: {
        url: row.profileVideoUrl,
        posterUrl: row.profileVideoPosterUrl,
        mime: row.profileVideoMime,
        durationSec: row.profileVideoDurationSec,
        sizeBytes: row.profileVideoSizeBytes,
        caption: row.profileVideoCaption,
        updatedAt: row.profileVideoUpdatedAt?.toISOString() ?? null,
      },
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    return jsonError("Failed to load profile video", 500);
  }
}

export async function POST(req: NextRequest) {
  let uploadedPathname: string | null = null;
  let uploadedPosterPathname: string | null = null;
  try {
    const user = await requireSessionUser();
    if (!user.emailVerified) return jsonError("Verify email first", 403);
    if (!user.onboardingComplete) {
      return jsonError("Complete your profile before uploading a video", 403);
    }

    const form = await req.formData();
    const file = form.get("file");
    const poster = form.get("poster");
    const captionRaw = form.get("caption");
    const durationRaw = form.get("durationSec");

    if (!(file instanceof File)) {
      return jsonError("Video file required", 400);
    }
    const mime = (file.type || "").toLowerCase();
    if (!ALLOWED_VIDEO_TYPES.has(mime)) {
      return jsonError(
        "Unsupported video format. Use MP4, MOV, or WebM.",
        400,
      );
    }
    if (file.size <= 0 || file.size > MAX_PROFILE_VIDEO_BYTES) {
      return jsonError(
        `Video must be under ${Math.round(MAX_PROFILE_VIDEO_BYTES / (1024 * 1024))} MB`,
        400,
      );
    }

    const durationSec = Number(durationRaw);
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      return jsonError("Could not read video duration", 400);
    }
    if (durationSec > MAX_PROFILE_VIDEO_SECONDS + 0.5) {
      return jsonError(
        `Videos must be ${MAX_PROFILE_VIDEO_SECONDS} seconds or shorter`,
        400,
      );
    }

    const caption =
      typeof captionRaw === "string" ? captionRaw.trim().slice(0, 200) : "";

    const existing = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        profileVideoUrl: true,
        profileVideoPathname: true,
        profileVideoPosterUrl: true,
        profileVideoPosterPathname: true,
      },
    });

    const token = process.env.BLOB_READ_WRITE_TOKEN || undefined;
    const buffer = Buffer.from(await file.arrayBuffer());
    const pathname = `profile-video/${user.id}/${Date.now()}-${randomBytes(4).toString("hex")}.${extForMime(mime)}`;
    const blob = await put(pathname, buffer, {
      access: "public",
      contentType: mime,
      token,
      addRandomSuffix: false,
    });
    uploadedPathname = blob.pathname || pathname;

    let posterUrl = "";
    let posterPathname = "";
    if (poster instanceof File && poster.size > 0) {
      const posterBuf = Buffer.from(await poster.arrayBuffer());
      const pPath = `profile-video/${user.id}/${Date.now()}-poster-${randomBytes(3).toString("hex")}.jpg`;
      const pBlob = await put(pPath, posterBuf, {
        access: "public",
        contentType: poster.type || "image/jpeg",
        token,
        addRandomSuffix: false,
      });
      posterUrl = pBlob.url;
      posterPathname = pBlob.pathname || pPath;
      uploadedPosterPathname = posterPathname;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        profileVideoUrl: blob.url,
        profileVideoPathname: uploadedPathname,
        profileVideoPosterUrl: posterUrl,
        profileVideoPosterPathname: posterPathname,
        profileVideoMime: mime,
        profileVideoDurationSec: Math.round(durationSec),
        profileVideoSizeBytes: file.size,
        profileVideoCaption: caption,
        profileVideoUpdatedAt: new Date(),
      },
    });

    // Delete previous blobs only after DB success
    for (const old of [
      existing.profileVideoPathname,
      existing.profileVideoPosterPathname,
    ]) {
      if (!old) continue;
      try {
        await del(old, { token });
      } catch (e) {
        console.error("[profile-video:cleanup-old]", old, e);
      }
    }

    return Response.json({
      ok: true,
      video: {
        url: blob.url,
        posterUrl,
        mime,
        durationSec: Math.round(durationSec),
        sizeBytes: file.size,
        caption,
      },
    });
  } catch (err) {
    const token = process.env.BLOB_READ_WRITE_TOKEN || undefined;
    for (const path of [uploadedPathname, uploadedPosterPathname]) {
      if (!path) continue;
      try {
        await del(path, { token });
      } catch {
        /* best-effort orphan cleanup */
      }
    }
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    console.error("[profile-video:post]", err);
    return jsonError("Could not upload profile video", 500);
  }
}

export async function DELETE() {
  try {
    const user = await requireSessionUser();
    const existing = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        profileVideoPathname: true,
        profileVideoPosterPathname: true,
        profileVideoUrl: true,
      },
    });
    if (!existing.profileVideoUrl) {
      return Response.json({ ok: true });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        profileVideoUrl: "",
        profileVideoPosterUrl: "",
        profileVideoPathname: "",
        profileVideoPosterPathname: "",
        profileVideoMime: "",
        profileVideoDurationSec: null,
        profileVideoSizeBytes: null,
        profileVideoCaption: "",
        profileVideoUpdatedAt: null,
      },
    });

    const token = process.env.BLOB_READ_WRITE_TOKEN || undefined;
    for (const path of [
      existing.profileVideoPathname,
      existing.profileVideoPosterPathname,
    ]) {
      if (!path) continue;
      try {
        await del(path, { token });
      } catch (e) {
        console.error("[profile-video:delete-blob]", path, e);
      }
    }

    return Response.json({ ok: true });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    return jsonError("Could not remove profile video", 500);
  }
}
