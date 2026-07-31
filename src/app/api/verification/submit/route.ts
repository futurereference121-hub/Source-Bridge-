import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendVerificationAdminAlert } from "@/lib/email";
import { jsonError } from "@/lib/validation";

export async function POST(req: Request) {
  try {
    const user = await getSessionUser();
    if (!user) return jsonError("Sign in required", 401);
    if (user.isDemo) {
      return jsonError(
        "Showcase profiles cannot submit identity verification",
        403,
      );
    }
    const body = await req.json().catch(() => ({}));
    const requestId = typeof body.requestId === "string" ? body.requestId : "";
    const request = await prisma.identityVerificationRequest.findFirst({
      where: { id: requestId, userId: user.id },
      include: { documents: { where: { deletedAt: null }, select: { id: true } } },
    });
    if (!request) return jsonError("Verification draft not found", 404);
    if (request.status === "PENDING") {
      return Response.json(
        { ok: true, requestId: request.id, status: "PENDING", alreadyPending: true },
        { status: 200 },
      );
    }
    if (request.status !== "DRAFT") {
      return jsonError("This verification request has already been submitted", 409);
    }

    const docs = await prisma.verificationDocument.findMany({
      where: { requestId: request.id, deletedAt: null },
      select: { kind: true },
    });
    const kinds = new Set(docs.map((d) => d.kind));
    const needsBack =
      request.documentType === "national_id" ||
      request.documentType === "driving_licence";
    if (!request.documentType) {
      return jsonError("Choose a document type before submitting", 400);
    }
    if (!kinds.has("front") || !kinds.has("selfie")) {
      return jsonError(
        "Upload the identity document and a selfie holding it before submitting",
        400,
      );
    }
    if (needsBack && !kinds.has("back")) {
      return jsonError("Upload the back of your ID before submitting", 400);
    }

    // Prevent duplicate PENDING submissions while one is open.
    const openPending = await prisma.identityVerificationRequest.findFirst({
      where: { userId: user.id, status: "PENDING" },
      select: { id: true },
    });
    if (openPending) {
      return jsonError(
        "You already have a verification request pending review",
        409,
      );
    }

    const updated = await prisma.identityVerificationRequest.update({
      where: { id: request.id },
      data: {
        status: "PENDING",
        submittedAt: new Date(),
        adminEmailStatus: process.env.VERIFICATION_ADMIN_EMAIL
          ? "pending"
          : "none",
      },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: {
        identityVerificationStatus: "PENDING",
        identityVerified: false,
      },
    });
    await prisma.verificationAuditEvent.create({
      data: {
        requestId: request.id,
        actorUserId: user.id,
        action: "submitted",
      },
    });
    if (process.env.VERIFICATION_ADMIN_EMAIL) {
      const result = await sendVerificationAdminAlert({
        requestId: request.id,
        applicantUsername: user.username || user.email,
        documentType: request.documentType,
        submittedAt: updated.submittedAt?.toISOString() || new Date().toISOString(),
      });
      await prisma.identityVerificationRequest.update({
        where: { id: request.id },
        data: { adminEmailStatus: result.ok ? "sent" : "failed" },
      });
    }
    return Response.json({ ok: true, requestId: updated.id, status: "PENDING" });
  } catch (error) {
    console.error("[verification:submit]", error);
    return jsonError("Could not submit verification request", 500);
  }
}
