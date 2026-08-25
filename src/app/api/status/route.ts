import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireSessionUser } from "@/lib/auth";
import { STATUS_TEXT_MAX } from "@/lib/limits";
import { jsonError, statusSchema } from "@/lib/validation";
import { isStatusActive } from "@/lib/member-status";
import { notifyFollowersOfPost } from "@/lib/notifications";
import { revalidatePublicMemberSurfaces } from "@/lib/revalidate-public";
import {
  deleteActiveStatus,
  publishStatusAtomic,
  readStatusPublishState,
} from "@/lib/status-publish";
import { z } from "zod";

export async function GET() {
  try {
    const user = await requireSessionUser();
    const now = new Date();
    const state = await readStatusPublishState(prisma, user.id, now);
    const status = state.active
      ? {
          id: state.active.id,
          text: state.active.text,
          postedAt: state.active.postedAt.toISOString(),
          expiresAt: state.active.expiresAt.toISOString(),
          version: state.active.postedAt.getTime(),
        }
      : null;
    return Response.json({
      status: isStatusActive(status) ? status : null,
      limit: state.limit,
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    return jsonError("Failed to load status", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (!user.emailVerified) return jsonError("Verify email first", 403);
    if (!user.onboardingComplete) {
      return jsonError("Complete your profile before publishing a status", 400);
    }

    const body = await req.json();
    const parsed = statusSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid status", 400);
    }

    const idempotencyKey =
      typeof body?.idempotencyKey === "string"
        ? body.idempotencyKey.trim().slice(0, 120)
        : "";

    const result = await publishStatusAtomic(prisma, {
      userId: user.id,
      text: parsed.data.text,
      idempotencyKey,
    });

    if (!result.ok) {
      return jsonError(result.message, 429, {
        code: result.code,
        limit: result.limit,
      });
    }

    if (!result.existing && user.slug) {
      await notifyFollowersOfPost({
        authorId: user.id,
        authorName: user.username ? `@${user.username}` : user.name,
        kind: "STATUS",
        text: result.status.text,
        href: `/members/${user.slug}`,
      });
    }

    revalidatePublicMemberSurfaces({
      slug: user.slug,
      username: user.username,
    });

    return Response.json({
      ok: true,
      existing: Boolean(result.existing),
      status: result.status,
      limit: result.limit,
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    if (status === 429) {
      return jsonError(err instanceof Error ? err.message : "Daily limit", 429);
    }
    console.error("[status:post]", err);
    return jsonError("Failed to publish status", 500);
  }
}

const patchSchema = z.object({
  text: z.string().trim().min(1).max(STATUS_TEXT_MAX),
});

/**
 * In-place text edit of the current active status.
 * Does NOT burn daily quota or advance the 1h publication cooldown.
 */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Invalid status", 400);
    }
    const now = new Date();
    const current = await prisma.statusUpdate.findFirst({
      where: { userId: user.id, expiresAt: { gt: now } },
      orderBy: { postedAt: "desc" },
    });
    if (!current) return jsonError("No active status to edit", 404);
    const updated = await prisma.statusUpdate.update({
      where: { id: current.id },
      data: { text: parsed.data.text },
    });
    revalidatePublicMemberSurfaces({
      slug: user.slug,
      username: user.username,
    });
    return Response.json({
      ok: true,
      status: {
        id: updated.id,
        text: updated.text,
        postedAt: updated.postedAt.toISOString(),
        expiresAt: updated.expiresAt.toISOString(),
        version: updated.postedAt.getTime(),
      },
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    return jsonError("Failed to edit status", 500);
  }
}

/** Delete/expire the current active status — does not consume a daily slot. */
export async function DELETE() {
  try {
    const user = await requireSessionUser();
    const { limit } = await deleteActiveStatus(prisma, user.id);
    revalidatePublicMemberSurfaces({
      slug: user.slug,
      username: user.username,
    });
    return Response.json({ ok: true, limit });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401) return jsonError("Sign in required", 401);
    return jsonError("Failed to delete status", 500);
  }
}
