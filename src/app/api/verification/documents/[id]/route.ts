import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deleteStoredImageForUser } from "@/lib/storage";
import { jsonError } from "@/lib/validation";
import { mapRequestForOwner } from "@/lib/verification";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Removes an uploaded verification document while its request is still a
 * draft, so applicants can fix a wrong upload without contacting support.
 */
export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const user = await getSessionUser();
    if (!user) return jsonError("Sign in required", 401);
    const { id } = await ctx.params;

    const document = await prisma.verificationDocument.findUnique({
      where: { id },
      include: { request: true },
    });
    if (
      !document ||
      document.deletedAt ||
      document.request.userId !== user.id
    ) {
      return jsonError("Document not found", 404);
    }
    if (document.request.status !== "DRAFT") {
      return jsonError(
        "Documents can only be removed while the request is a draft",
        400,
      );
    }

    await deleteStoredImageForUser(document.url, user.id);
    await prisma.verificationDocument.delete({ where: { id } });
    await prisma.verificationAuditEvent.create({
      data: {
        requestId: document.requestId,
        actorUserId: user.id,
        action: "document_removed",
        meta: JSON.stringify({ kind: document.kind }),
      },
    });

    const fresh = await prisma.identityVerificationRequest.findUnique({
      where: { id: document.requestId },
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
  } catch (error) {
    console.error("[verification:documents:delete]", error);
    return jsonError("Could not remove document", 500);
  }
}
