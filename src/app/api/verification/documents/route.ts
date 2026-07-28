import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  deleteStoredImageForUser,
  storeImageForUser,
  validateImageFile,
} from "@/lib/storage";
import { jsonError } from "@/lib/validation";
import {
  isDocumentKind,
  mapRequestForOwner,
  syncUserVerificationStatus,
} from "@/lib/verification";

/**
 * Private identity document upload (Vercel Blob private / local private/).
 * Never returns document URLs — only metadata confirming upload.
 */
export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return jsonError("Sign in required", 401);

    if (user.identityVerified) {
      return jsonError("Your identity is already verified", 400);
    }

    const form = await req.formData();
    const file = form.get("file");
    const kindRaw = form.get("kind");
    const kind = typeof kindRaw === "string" ? kindRaw.trim() : "";
    const requestIdRaw = form.get("requestId");
    const requestId =
      typeof requestIdRaw === "string" ? requestIdRaw.trim() : "";

    if (!(file instanceof File)) {
      return jsonError("file is required", 400);
    }
    if (!isDocumentKind(kind)) {
      return jsonError("Document kind must be front, back, or selfie", 400);
    }

    const validationError = validateImageFile({
      type: file.type,
      size: file.size,
    });
    if (validationError) return jsonError(validationError, 400);

    let request = requestId
      ? await prisma.identityVerificationRequest.findFirst({
          where: { id: requestId, userId: user.id },
        })
      : await prisma.identityVerificationRequest.findFirst({
          where: { userId: user.id, status: "PENDING" },
          orderBy: { createdAt: "desc" },
        });

    if (!request) {
      request = await prisma.identityVerificationRequest.create({
        data: {
          userId: user.id,
          status: "PENDING",
          documentType: "",
        },
      });
    }

    if (request.status === "VERIFIED") {
      return jsonError("This request is already verified", 400);
    }

    // Re-open rejected requests when new documents are uploaded.
    if (request.status === "REJECTED") {
      request = await prisma.identityVerificationRequest.update({
        where: { id: request.id },
        data: {
          status: "PENDING",
          rejectionReason: "",
          rejectedAt: null,
          reviewedAt: null,
          reviewerId: null,
        },
      });
    }

    const stored = await storeImageForUser(file, {
      userId: user.id,
      folder: "verification",
      access: "private",
    });
    if (!stored.ok) return jsonError(stored.error, 400);

    const existingDoc = await prisma.verificationDocument.findFirst({
      where: { requestId: request.id, kind },
    });
    if (existingDoc) {
      await deleteStoredImageForUser(existingDoc.url, user.id);
      await prisma.verificationDocument.delete({
        where: { id: existingDoc.id },
      });
    }

    await prisma.verificationDocument.create({
      data: {
        requestId: request.id,
        kind,
        url: stored.image.url,
        pathname: stored.image.pathname || "",
        mimeType: stored.image.contentType,
        sizeBytes: stored.image.size,
      },
    });

    await syncUserVerificationStatus(user.id, "PENDING");

    const fresh = await prisma.identityVerificationRequest.findUnique({
      where: { id: request.id },
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

    return Response.json({
      ok: true,
      request: fresh ? mapRequestForOwner(fresh) : null,
    });
  } catch (err) {
    console.error("[verification:documents]", err);
    return jsonError("Document upload failed", 500);
  }
}
