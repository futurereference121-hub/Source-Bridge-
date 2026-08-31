import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { getOrCreateConversationPair } from "@/lib/messaging";
import { assertUserCanReceiveMessages } from "@/lib/discoverability";
import { isAllowedAttachmentUrl } from "@/lib/messaging";
import { LIVE_CAPTURE_SUGGESTED_TEXT } from "./constants";
import { expireLiveIfNeeded } from "./sessions";

function httpError(message: string, status: number, code?: string): never {
  const err = new Error(message) as Error & { status: number; code?: string };
  err.status = status;
  if (code) err.code = code;
  throw err;
}

/**
 * Capture Item: open the existing 1:1 conversation with a preview image and
 * suggested text. Does NOT send a message.
 */
export async function prepareLiveCaptureMessage(opts: {
  user: SessionUser;
  sessionId: string;
  imageUrl: string;
  viewedOffsetSeconds?: number;
  now?: Date;
}) {
  const now = opts.now ?? new Date();
  const row = await expireLiveIfNeeded(opts.sessionId, now);
  if (!row) httpError("Live not found", 404);
  if (row.status !== "LIVE") httpError("Capture is only available while Live", 409);
  if (row.broadcasterId === opts.user.id) {
    httpError("You cannot Capture Item on your own Live", 400);
  }
  if (!isAllowedAttachmentUrl(opts.imageUrl, opts.user.id)) {
    httpError("Invalid capture image", 400, "INVALID_IMAGE");
  }

  const broadcaster = await prisma.user.findUnique({
    where: { id: row.broadcasterId },
    select: {
      id: true,
      isAdmin: true,
      role: true,
      isTestAccount: true,
      isDemo: true,
      deletedAt: true,
      isDiscoverable: true,
      username: true,
    },
  });
  assertUserCanReceiveMessages(broadcaster);

  const { conversation } = await getOrCreateConversationPair(
    opts.user.id,
    row.broadcasterId,
    { contextType: "direct" },
  );

  const handle = broadcaster?.username ? `@${broadcaster.username}` : "there";
  const suggestedText = `${LIVE_CAPTURE_SUGGESTED_TEXT} (${row.title})`;

  return {
    conversationId: conversation.id,
    imageUrl: opts.imageUrl,
    suggestedText,
    viewedOffsetSeconds: opts.viewedOffsetSeconds ?? null,
    sourcerUsername: handle,
    autoSent: false as const,
  };
}
