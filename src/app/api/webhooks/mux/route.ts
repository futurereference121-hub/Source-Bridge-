import { prisma } from "@/lib/db";
import { createNotification } from "@/lib/notifications";
import { revalidatePublicMemberSurfaces } from "@/lib/revalidate-public";
import {
  isMuxConfigured,
  isMuxWebhookConfigured,
  verifyMuxWebhook,
} from "@/lib/mux-stories";
import {
  attachMuxAssetToClip,
  markMuxClipFailed,
  markMuxClipReady,
} from "@/lib/stories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type MuxEventBody = {
  type?: string;
  data?: {
    id?: string;
    asset_id?: string;
    upload_id?: string;
    passthrough?: string;
    duration?: number;
    playback_ids?: Array<{ id?: string; policy?: string }>;
    errors?: { messages?: string[] };
    new_asset_settings?: { passthrough?: string };
  };
  object?: { type?: string; id?: string };
};

/** Public playback id, ignoring signed/DRM ids we do not use. */
function publicPlaybackId(data: MuxEventBody["data"]): string {
  const ids = data?.playback_ids || [];
  const preferred = ids.find((p) => p.policy === "public") || ids[0];
  return preferred?.id || "";
}

function errorReason(data: MuxEventBody["data"]): string {
  const messages = data?.errors?.messages || [];
  return messages.length
    ? messages.join(" ")
    : "This video could not be processed.";
}

async function notifyOwner(clipUserId: string, storyIsReady: boolean) {
  const owner = await prisma.user.findUnique({
    where: { id: clipUserId },
    select: { id: true, slug: true, username: true },
  });
  if (!owner) return;

  if (storyIsReady) {
    await createNotification({
      userId: owner.id,
      type: "SYSTEM",
      title: "Your Story is ready",
      body: "Your Story is now live on your profile for the next 24 hours.",
      href: owner.slug ? `/members/${owner.slug}` : "/dashboard",
    });
  }
  revalidatePublicMemberSurfaces({
    slug: owner.slug,
    username: owner.username,
  });
}

/**
 * Mux webhook receiver. The raw body is verified against MUX_WEBHOOK_SECRET
 * before anything is parsed, and every handler is idempotent because Mux
 * retries. Playback URLs are derived from the verified payload — a client
 * can never hand us an arbitrary media URL.
 */
export async function POST(req: Request) {
  const raw = await req.text();

  if (!isMuxConfigured() || !isMuxWebhookConfigured()) {
    console.error("[mux:webhook] received an event but Mux is not configured");
    return new Response("Mux is not configured", { status: 503 });
  }

  try {
    await verifyMuxWebhook(raw, req.headers);
  } catch (err) {
    console.error(
      "[mux:webhook] signature verification failed",
      err instanceof Error ? err.message : "unknown error",
    );
    return new Response("Invalid signature", { status: 401 });
  }

  let event: MuxEventBody;
  try {
    event = JSON.parse(raw) as MuxEventBody;
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }

  const type = event.type || "";
  const data = event.data || {};

  try {
    switch (type) {
      case "video.upload.asset_created": {
        const assetId = data.asset_id || "";
        if (!assetId) break;
        await attachMuxAssetToClip({
          assetId,
          uploadId: data.id || null,
          passthrough:
            data.new_asset_settings?.passthrough || data.passthrough || null,
        });
        break;
      }

      case "video.asset.ready": {
        const assetId = data.id || "";
        const playbackId = publicPlaybackId(data);
        if (!assetId || !playbackId) break;
        const result = await markMuxClipReady({
          assetId,
          passthrough: data.passthrough || null,
          playbackId,
          durationSec: Number(data.duration || 0),
        });
        if (result.outcome === "ready") {
          await notifyOwner(result.clip.userId, true);
        } else if (result.outcome === "rejected") {
          console.error(
            "[mux:webhook] asset rejected after processing",
            result.clip.id,
            result.reason,
          );
        }
        break;
      }

      case "video.asset.errored": {
        await markMuxClipFailed({
          assetId: data.id || null,
          uploadId: data.upload_id || null,
          passthrough: data.passthrough || null,
          reason: errorReason(data),
        });
        break;
      }

      case "video.upload.errored":
      case "video.upload.cancelled": {
        await markMuxClipFailed({
          uploadId: data.id || null,
          assetId: data.asset_id || null,
          passthrough:
            data.new_asset_settings?.passthrough || data.passthrough || null,
          reason: errorReason(data),
        });
        break;
      }

      default:
        break;
    }
  } catch (err) {
    // 500 tells Mux to retry — safe because every handler is idempotent.
    console.error("[mux:webhook] handler failed", type, err);
    return new Response("Handler failed", { status: 500 });
  }

  return Response.json({ ok: true, type });
}
