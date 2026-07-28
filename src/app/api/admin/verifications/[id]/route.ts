import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendVerificationApplicantNotice } from "@/lib/email";
import { sendVerificationResultMessage } from "@/lib/system-messages";
import { jsonError } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const admin = await requireAdmin();
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const action = body.action === "approve" ? "approve" : body.action === "reject" ? "reject" : "";
    const rejectionReason = typeof body.rejectionReason === "string" ? body.rejectionReason.trim().slice(0, 2000) : "";
    if (!action) return jsonError("action must be approve or reject", 400);
    if (action === "reject" && !rejectionReason) return jsonError("rejectionReason is required", 400);
    const request = await prisma.identityVerificationRequest.findUnique({ where: { id }, include: { user: { select: { email: true } } } });
    if (!request) return jsonError("Request not found", 404);
    if (request.status !== "PENDING") return jsonError("Only pending requests can be reviewed", 409);
    const now = new Date();
    const approved = action === "approve";
    await prisma.$transaction(async (tx) => {
      await tx.identityVerificationRequest.update({
        where: { id },
        data: {
          status: approved ? "VERIFIED" : "REJECTED",
          reviewerId: admin.id,
          reviewedByAdminId: admin.id,
          reviewedAt: now,
          approvedAt: approved ? now : null,
          rejectedAt: approved ? null : now,
          rejectionReason: approved ? "" : rejectionReason,
          applicantEmailStatus: body.notifyApplicant === false ? "none" : "pending",
        },
      });
      await tx.user.update({
        where: { id: request.userId },
        data: { identityVerificationStatus: approved ? "VERIFIED" : "REJECTED", identityVerified: approved },
      });
      await tx.verificationAuditEvent.create({
        data: { requestId: id, actorUserId: admin.id, action: approved ? "approved" : "rejected", meta: JSON.stringify({ rejectionReason: approved ? undefined : rejectionReason }) },
      });
    });
    await sendVerificationResultMessage({ userId: request.userId, approved, rejectionReason, requestId: id });
    if (body.notifyApplicant !== false) {
      const result = await sendVerificationApplicantNotice({ to: request.user.email, approved, rejectionReason });
      await prisma.identityVerificationRequest.update({ where: { id }, data: { applicantEmailStatus: result.ok ? "sent" : "failed" } });
    }
    return Response.json({ ok: true, status: approved ? "VERIFIED" : "REJECTED" });
  } catch (error) {
    console.error("[admin:verification-review]", error);
    const status = (error as { status?: number }).status || 500;
    return jsonError(status === 401 ? "Sign in required" : status === 403 ? "Admin only" : "Review failed", status);
  }
}
