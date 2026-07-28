import { prisma } from "@/lib/db";
import { deleteStoredImageForUser } from "@/lib/storage";

function retentionDays(): number {
  const value = Number(process.env.VERIFICATION_DOCUMENT_RETENTION_DAYS || 30);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 30;
}

export async function cleanupVerificationDocuments(now = new Date()) {
  const cutoff = new Date(now.getTime() - retentionDays() * 86_400_000);
  const requests = await prisma.identityVerificationRequest.findMany({
    where: { status: { in: ["VERIFIED", "REJECTED"] }, reviewedAt: { lte: cutoff }, documentDeletedAt: null },
    include: { documents: { where: { deletedAt: null } } },
  });
  let removed = 0;
  for (const request of requests) {
    for (const document of request.documents) {
      await deleteStoredImageForUser(document.url, request.userId);
      await prisma.verificationDocument.update({ where: { id: document.id }, data: { deletedAt: now } });
      removed += 1;
    }
    await prisma.$transaction([
      prisma.identityVerificationRequest.update({ where: { id: request.id }, data: { documentDeletedAt: now } }),
      prisma.verificationAuditEvent.create({ data: { requestId: request.id, action: "documents_deleted_by_retention", meta: JSON.stringify({ retentionDays: retentionDays() }) } }),
    ]);
  }
  return { requests: requests.length, documents: removed, retentionDays: retentionDays() };
}
