import { NextRequest } from "next/server";
import { getSessionUser, toPublicAccount } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { jsonError } from "@/lib/validation";
import {
  getLatestVerificationRequest,
  isDocumentType,
  mapRequestForOwner,
  syncUserVerificationStatus,
} from "@/lib/verification";

/**
 * GET — current identity verification status + latest request (no private URLs).
 * POST — start / resubmit a verification request (status stays PENDING until admin review).
 */
export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return jsonError("Sign in required", 401);

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        identityVerified: true,
        identityVerificationStatus: true,
      },
    });
    const request = await getLatestVerificationRequest(user.id);

    return Response.json({
      ok: true,
      status:
        dbUser?.identityVerificationStatus ||
        (dbUser?.identityVerified ? "VERIFIED" : "UNVERIFIED"),
      identityVerified: Boolean(dbUser?.identityVerified),
      request: request ? mapRequestForOwner(request) : null,
    });
  } catch (err) {
    console.error("[verification:GET]", err);
    return jsonError("Failed to load verification status", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser();
    if (!user) return jsonError("Sign in required", 401);

    const body = await req.json().catch(() => ({}));
    const documentType =
      typeof body.documentType === "string" ? body.documentType.trim() : "";
    const notes =
      typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) : "";

    if (!isDocumentType(documentType)) {
      return jsonError(
        "Choose passport, national ID, or driving licence",
        400,
      );
    }

    const existing = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        identityVerified: true,
        identityVerificationStatus: true,
      },
    });
    if (existing?.identityVerified) {
      return jsonError("Your identity is already verified", 400);
    }

    const pending = await prisma.identityVerificationRequest.findFirst({
      where: { userId: user.id, status: "PENDING" },
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

    if (pending) {
      const updated = await prisma.identityVerificationRequest.update({
        where: { id: pending.id },
        data: { documentType, notes },
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
      await syncUserVerificationStatus(user.id, "PENDING");
      const refreshed = await getSessionUser();
      return Response.json({
        ok: true,
        request: mapRequestForOwner(updated),
        account: refreshed ? toPublicAccount(refreshed) : undefined,
      });
    }

    const created = await prisma.identityVerificationRequest.create({
      data: {
        userId: user.id,
        status: "PENDING",
        documentType,
        notes,
      },
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

    await syncUserVerificationStatus(user.id, "PENDING");
    const refreshed = await getSessionUser();

    return Response.json({
      ok: true,
      request: mapRequestForOwner(created),
      account: refreshed ? toPublicAccount(refreshed) : undefined,
    });
  } catch (err) {
    console.error("[verification:POST]", err);
    return jsonError("Could not create verification request", 500);
  }
}
