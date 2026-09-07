import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { expireLiveIfNeeded } from "@/lib/live/sessions";
import { publishLiveCommentEvent } from "./ably-server";
import {
  LIVE_COMMENT_MAX_LENGTH,
  LIVE_COMMENT_RATE_PER_MINUTE,
  LIVE_COMMENT_RECENT_LIMIT,
  LIVE_COMMENT_REJECTED_MESSAGE,
  LIVE_COMMENT_TOO_FAST_MESSAGE,
} from "./constants";
import type { LiveCommentPublic } from "./types";

export type { LiveCommentPublic } from "./types";

function httpError(message: string, status: number, code?: string): never {
  const err = new Error(message) as Error & { status: number; code?: string };
  err.status = status;
  if (code) err.code = code;
  throw err;
}

/** Strip tags / control chars; plain text only. */
export function sanitizeLiveCommentBody(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toPublic(row: {
  id: string;
  body: string;
  createdAt: Date;
  commenter: {
    id: string;
    username: string | null;
    name: string;
    photo: string;
  };
}): LiveCommentPublic {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    commenter: {
      id: row.commenter.id,
      username: row.commenter.username,
      name: row.commenter.name,
      photo: row.commenter.photo || "",
    },
  };
}

export async function listRecentLiveComments(opts: {
  user: SessionUser;
  sessionId: string;
  limit?: number;
  now?: Date;
}): Promise<{ comments: LiveCommentPublic[]; liveSessionId: string }> {
  if (!opts.user) httpError("Sign in required", 401, "UNAUTHENTICATED");
  const now = opts.now ?? new Date();
  const row = await expireLiveIfNeeded(opts.sessionId, now);
  if (!row) httpError("Live not found", 404);
  // Late joiners during LIVE only — post-Live comments are audit-only, not public archive.
  if (row.status !== "LIVE") {
    httpError("This Live has ended", 409, "NOT_LIVE");
  }

  const limit = Math.min(
    Math.max(1, opts.limit ?? LIVE_COMMENT_RECENT_LIMIT),
    LIVE_COMMENT_RECENT_LIMIT,
  );
  const rows = await prisma.liveComment.findMany({
    where: { liveSessionId: row.id },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      commenter: {
        select: { id: true, username: true, name: true, photo: true },
      },
    },
  });
  // Return ascending for UI stack (oldest → newest).
  const comments = rows.reverse().map(toPublic);
  return { comments, liveSessionId: row.id };
}

export async function createLiveComment(opts: {
  user: SessionUser;
  sessionId: string;
  body: unknown;
  clientMessageId?: unknown;
  now?: Date;
}): Promise<LiveCommentPublic> {
  if (!opts.user) httpError("Sign in required", 401, "UNAUTHENTICATED");
  const now = opts.now ?? new Date();
  const row = await expireLiveIfNeeded(opts.sessionId, now);
  if (!row) httpError("Live not found", 404);
  if (row.status !== "LIVE") {
    httpError("Comments are closed for this Live", 409, "NOT_LIVE");
  }
  if (!row.endsAt || now.getTime() >= row.endsAt.getTime()) {
    httpError("Comments are closed for this Live", 409, "NOT_LIVE");
  }

  const body = sanitizeLiveCommentBody(opts.body);
  if (!body) {
    httpError(LIVE_COMMENT_REJECTED_MESSAGE, 400, "EMPTY");
  }
  if (body.length > LIVE_COMMENT_MAX_LENGTH) {
    httpError(LIVE_COMMENT_REJECTED_MESSAGE, 400, "TOO_LONG");
  }

  let clientMessageId =
    typeof opts.clientMessageId === "string"
      ? opts.clientMessageId.trim().slice(0, 64)
      : "";
  if (!clientMessageId) {
    clientMessageId = `auto_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  const minuteAgo = new Date(now.getTime() - 60_000);
  const recentCount = await prisma.liveComment.count({
    where: {
      liveSessionId: row.id,
      commenterId: opts.user.id,
      createdAt: { gte: minuteAgo },
    },
  });
  if (recentCount >= LIVE_COMMENT_RATE_PER_MINUTE) {
    httpError(LIVE_COMMENT_TOO_FAST_MESSAGE, 429, "RATE_LIMIT");
  }

  // Idempotent resubmit of the same clientMessageId.
  const existing = await prisma.liveComment.findUnique({
    where: {
      liveSessionId_commenterId_clientMessageId: {
        liveSessionId: row.id,
        commenterId: opts.user.id,
        clientMessageId,
      },
    },
    include: {
      commenter: {
        select: { id: true, username: true, name: true, photo: true },
      },
    },
  });
  if (existing) {
    return toPublic(existing);
  }

  let created;
  try {
    created = await prisma.liveComment.create({
      data: {
        liveSessionId: row.id,
        commenterId: opts.user.id,
        body,
        clientMessageId,
        createdAt: now,
      },
      include: {
        commenter: {
          select: { id: true, username: true, name: true, photo: true },
        },
      },
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") {
      const again = await prisma.liveComment.findUnique({
        where: {
          liveSessionId_commenterId_clientMessageId: {
            liveSessionId: row.id,
            commenterId: opts.user.id,
            clientMessageId,
          },
        },
        include: {
          commenter: {
            select: { id: true, username: true, name: true, photo: true },
          },
        },
      });
      if (again) return toPublic(again);
    }
    throw err;
  }

  const pub = toPublic(created);
  // Fanout after commit — never trust browser publish of canonical comments.
  await publishLiveCommentEvent({
    liveSessionId: row.id,
    comment: pub,
  });
  return pub;
}
