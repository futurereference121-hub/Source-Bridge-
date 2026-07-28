-- Additive verification workflow + private document storage support.
-- Preserves existing users, listings, and prior IdentityVerificationRequest rows.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "identityVerificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED';

UPDATE "User"
SET "identityVerificationStatus" = 'VERIFIED'
WHERE "identityVerified" = true AND "identityVerificationStatus" = 'UNVERIFIED';

ALTER TABLE "IdentityVerificationRequest" ADD COLUMN IF NOT EXISTS "documentType" TEXT NOT NULL DEFAULT '';
ALTER TABLE "IdentityVerificationRequest" ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT NOT NULL DEFAULT '';
ALTER TABLE "IdentityVerificationRequest" ADD COLUMN IF NOT EXISTS "reviewerId" TEXT;
ALTER TABLE "IdentityVerificationRequest" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "IdentityVerificationRequest" ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMP(3);
ALTER TABLE "IdentityVerificationRequest" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Normalize older lowercase statuses
UPDATE "IdentityVerificationRequest"
SET "status" = UPPER("status")
WHERE "status" IN ('pending', 'verified', 'rejected', 'unverified');

CREATE INDEX IF NOT EXISTS "IdentityVerificationRequest_status_createdAt_idx"
  ON "IdentityVerificationRequest"("status", "createdAt");

CREATE TABLE IF NOT EXISTS "VerificationDocument" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "pathname" TEXT NOT NULL DEFAULT '',
    "mimeType" TEXT NOT NULL DEFAULT '',
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VerificationDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "VerificationDocument_requestId_idx" ON "VerificationDocument"("requestId");

DO $$ BEGIN
  ALTER TABLE "VerificationDocument" ADD CONSTRAINT "VerificationDocument_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "IdentityVerificationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
