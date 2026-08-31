import { prisma } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { LIVE_REPORT_REASONS, type LiveReportReason } from "./constants";

function httpError(message: string, status: number, code?: string): never {
  const err = new Error(message) as Error & { status: number; code?: string };
  err.status = status;
  if (code) err.code = code;
  throw err;
}

export async function reportLiveSession(opts: {
  user: SessionUser;
  sessionId: string;
  reason: string;
  notes?: string;
}) {
  if (opts.user.role === "ADMIN" || opts.user.isAdmin) {
    httpError("Admin accounts cannot file Live reports here", 403);
  }
  const reason = LIVE_REPORT_REASONS.includes(opts.reason as LiveReportReason)
    ? opts.reason
    : null;
  if (!reason) httpError("Choose a report reason", 400);

  const session = await prisma.liveSession.findUnique({
    where: { id: opts.sessionId },
    select: { id: true, broadcasterId: true },
  });
  if (!session) httpError("Live not found", 404);
  if (session.broadcasterId === opts.user.id) {
    httpError("You cannot report your own Live", 400);
  }

  try {
    const row = await prisma.liveReport.create({
      data: {
        liveSessionId: session.id,
        reporterUserId: opts.user.id,
        reason,
        notes: (opts.notes || "").trim().slice(0, 500),
      },
    });
    return { id: row.id, created: true };
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2002") {
      return { id: "", created: false };
    }
    throw err;
  }
}
