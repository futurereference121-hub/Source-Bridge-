import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  deleteStoredImageForUser,
  storePrivateVerificationImage,
  validateImageFile,
} from "@/lib/storage";
import { jsonError } from "@/lib/validation";
import { assertDailyLimit, recordDailyAction } from "@/lib/rate-limit";
import {
  isDocumentKind,
  mapRequestForOwner,
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
    await assertDailyLimit(user.id, "verification_upload");

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
          where: { id: requestId, userId: user.id, status: "DRAFT" },
        })
      : await prisma.identityVerificationRequest.findFirst({
          where: { userId: user.id, status: "DRAFT" },
          orderBy: { createdAt: "desc" },
        });

    if (!request) {
      request = await prisma.identityVerificationRequest.create({
        data: {
          userId: user.id,
          status: "DRAFT",
          documentType: "",
        },
      });
    }

    const stored = await storePrivateVerificationImage(file, user.id);
    if (!stored.ok) return jsonError(stored.clientError || stored.error, 400);

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

    await prisma.verificationAuditEvent.create({
      data: { requestId: request.id, actorUserId: user.id, action: "document_uploaded", meta: JSON.stringify({ kind }) },
    });
    await recordDailyAction(user.id, "verification_upload");

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
    if ((err as { status?: number }).status === 429) return jsonError(err instanceof Error ? err.message : "Upload limit reached", 429);
    console.error("[verification:documents]", err);
    return jsonError("Document upload failed", 500);
  }
}
