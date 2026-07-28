import { PrismaClient } from "@prisma/client";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { del } from "@vercel/blob";

const prisma = new PrismaClient();
const days = Math.max(1, Number(process.env.VERIFICATION_DOCUMENT_RETENTION_DAYS || 30));
const cutoff = new Date(Date.now() - days * 86_400_000);
let removed = 0;

try {
  const requests = await prisma.identityVerificationRequest.findMany({
    where: { status: { in: ["VERIFIED", "REJECTED"] }, reviewedAt: { lte: cutoff }, documentDeletedAt: null },
    include: { documents: { where: { deletedAt: null } } },
  });
  for (const request of requests) {
    for (const document of request.documents) {
      if (document.url.startsWith("private://")) {
        await unlink(path.join(process.cwd(), "private", document.url.slice("private://".length))).catch(() => {});
      } else if (process.env.BLOB_PRIVATE_READ_WRITE_TOKEN) {
        await del(document.url, { token: process.env.BLOB_PRIVATE_READ_WRITE_TOKEN });
      } else {
        throw new Error(`Cannot delete private Blob document ${document.id}: BLOB_PRIVATE_READ_WRITE_TOKEN is required.`);
      }
      await prisma.verificationDocument.update({ where: { id: document.id }, data: { deletedAt: new Date() } });
      removed++;
    }
    await prisma.$transaction([
      prisma.identityVerificationRequest.update({ where: { id: request.id }, data: { documentDeletedAt: new Date() } }),
      prisma.verificationAuditEvent.create({ data: { requestId: request.id, action: "documents_deleted_by_retention", meta: JSON.stringify({ retentionDays: days }) } }),
    ]);
  }
  console.log(`Deleted ${removed} verification document(s) from ${requests.length} request(s).`);
} finally {
  await prisma.$disconnect();
}
