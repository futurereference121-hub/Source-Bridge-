import { NextRequest } from "next/server";
import { getSessionUser, isAdminUser, toPublicAccount } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/validation";
import {
  assertCanReview,
  mapRequestForOwner,
  syncUserVerificationStatus,
} from "@/lib/verification";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Admin review API (no dashboard UI yet).
 * PATCH body: { action: "approve" | "reject", rejectionReason?: string, notes?: string }
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const user = await getSessionUser();
    if (!user) return jsonError("Sign in required", 401);
    try {
      assertCanReview(user);
    } catch {
      return jsonError("Admin only", 403);
    }

    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "";
    const rejectionReason =
      typeof body.rejectionReason === "string"
        ? body.rejectionReason.trim().slice(0, 2000)
        : "";
    const notes =
      typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) : "";

    const request = await prisma.identityVerificationRequest.findUnique({
      where: { id },
      include: {
        documents: {
          select: {
            id: true,
            kind: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
          },
        },
      },
    });
    if (!request) return jsonError("Request not found", 404);

    const now = new Date();

    if (action === "approve") {
      const updated = await prisma.identityVerificationRequest.update({
        where: { id },
        data: {
          status: "VERIFIED",
          reviewerId: user.id,
          reviewedAt: now,
          approvedAt: now,
          rejectedAt: null,
          rejectionReason: "",
          notes: notes || request.notes,
        },
        include: {
          documents: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              kind: true,
              mimeType: true,
              sizeBytes: true,
              createdAt: true,
            },
          },
        },
      });
      await syncUserVerificationStatus(request.userId, "VERIFIED", {
        identityVerified: true,
      });
      return Response.json({
        ok: true,
        request: mapRequestForOwner(updated),
      });
    }

    if (action === "reject") {
      if (!rejectionReason) {
        return jsonError("rejectionReason is required", 400);
      }
      const updated = await prisma.identityVerificationRequest.update({
        where: { id },
        data: {
          status: "REJECTED",
          reviewerId: user.id,
          reviewedAt: now,
          rejectedAt: now,
          approvedAt: null,
          rejectionReason,
          notes: notes || request.notes,
        },
        include: {
          documents: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              kind: true,
              mimeType: true,
              sizeBytes: true,
              createdAt: true,
            },
          },
        },
      });
      await syncUserVerificationStatus(request.userId, "REJECTED", {
        identityVerified: false,
      });
      return Response.json({
        ok: true,
        request: mapRequestForOwner(updated),
      });
    }

    return jsonError("action must be approve or reject", 400);
  } catch (err) {
    console.error("[verification:admin]", err);
    return jsonError("Review failed", 500);
  }
}

/** Owner can read their own request metadata (no private URLs). */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await getSessionUser();
    if (!user) return jsonError("Sign in required", 401);
    const { id } = await ctx.params;

    const request = await prisma.identityVerificationRequest.findUnique({
      where: { id },
      include: {
        documents: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            kind: true,
            mimeType: true,
            sizeBytes: true,
            createdAt: true,
          },
        },
      },
    });
    if (!request) return jsonError("Request not found", 404);
    if (request.userId !== user.id && !isAdminUser(user)) {
      return jsonError("Not found", 404);
    }

    return Response.json({
      ok: true,
      request: mapRequestForOwner(request),
      account: toPublicAccount(user),
    });
  } catch (err) {
    console.error("[verification:id GET]", err);
    return jsonError("Failed to load request", 500);
  }
}
