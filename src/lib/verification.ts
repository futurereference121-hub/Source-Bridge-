import { prisma } from "@/lib/db";
import { isAdminUser, type SessionUser } from "@/lib/auth";

export const VERIFICATION_STATUSES = [
  "UNVERIFIED",
  "PENDING",
  "VERIFIED",
  "REJECTED",
] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const DOCUMENT_TYPES = [
  "passport",
  "national_id",
  "driving_licence",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_KINDS = ["front", "back", "selfie"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export function isDocumentType(value: string): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value);
}

export function isDocumentKind(value: string): value is DocumentKind {
  return (DOCUMENT_KINDS as readonly string[]).includes(value);
}

/** Public badge: only VERIFIED / identityVerified. */
export function isIdentityBadgeVisible(user: {
  identityVerified: boolean;
  identityVerificationStatus?: string | null;
}): boolean {
  if (user.identityVerified) return true;
  return (user.identityVerificationStatus || "").toUpperCase() === "VERIFIED";
}

export function mapRequestForOwner(request: {
  id: string;
  status: string;
  documentType: string;
  notes: string;
  rejectionReason: string;
  reviewedAt: Date | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  documents: Array<{
    id: string;
    kind: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: Date;
  }>;
}) {
  return {
    id: request.id,
    status: request.status,
    documentType: request.documentType,
    notes: request.notes,
    rejectionReason: request.rejectionReason,
    reviewedAt: request.reviewedAt?.toISOString() ?? null,
    approvedAt: request.approvedAt?.toISOString() ?? null,
    rejectedAt: request.rejectedAt?.toISOString() ?? null,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    documents: request.documents.map((d) => ({
      id: d.id,
      kind: d.kind,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      createdAt: d.createdAt.toISOString(),
      // Never expose private Blob/local URLs to the client.
      uploaded: true,
    })),
  };
}

export async function getLatestVerificationRequest(userId: string) {
  return prisma.identityVerificationRequest.findFirst({
    where: { userId },
    orderBy: { createdAt: "desc" },
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
}

export async function syncUserVerificationStatus(
  userId: string,
  status: VerificationStatus,
  opts?: { identityVerified?: boolean },
) {
  const identityVerified =
    opts?.identityVerified ?? status === "VERIFIED";
  return prisma.user.update({
    where: { id: userId },
    data: {
      identityVerificationStatus: status,
      identityVerified,
    },
  });
}

export function assertCanReview(user: SessionUser) {
  if (!isAdminUser(user)) {
    const err = new Error("Admin only");
    (err as Error & { status: number }).status = 403;
    throw err;
  }
}
