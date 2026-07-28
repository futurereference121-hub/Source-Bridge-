-- Additive migration: safe to apply to existing Neon/PostgreSQL databases.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "role" TEXT NOT NULL DEFAULT 'USER';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ListingImage" (
  "id" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isCover" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ListingImage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ListingImage_listingId_url_key" ON "ListingImage"("listingId", "url");
CREATE INDEX IF NOT EXISTS "ListingImage_listingId_sortOrder_idx" ON "ListingImage"("listingId", "sortOrder");
DO $$ BEGIN
  ALTER TABLE "ListingImage" ADD CONSTRAINT "ListingImage_listingId_fkey"
  FOREIGN KEY ("listingId") REFERENCES "StockListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "IdentityVerificationRequest" ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3);
ALTER TABLE "IdentityVerificationRequest" ADD COLUMN IF NOT EXISTS "reviewedByAdminId" TEXT;
ALTER TABLE "IdentityVerificationRequest" ADD COLUMN IF NOT EXISTS "documentDeletedAt" TIMESTAMP(3);
ALTER TABLE "IdentityVerificationRequest" ADD COLUMN IF NOT EXISTS "adminEmailStatus" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "IdentityVerificationRequest" ADD COLUMN IF NOT EXISTS "applicantEmailStatus" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "VerificationDocument" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
DO $$ BEGIN
  ALTER TABLE "IdentityVerificationRequest" ADD CONSTRAINT "IdentityVerificationRequest_reviewedByAdminId_fkey"
  FOREIGN KEY ("reviewedByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "VerificationAuditEvent" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "meta" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VerificationAuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "VerificationAuditEvent_requestId_idx" ON "VerificationAuditEvent"("requestId");
CREATE INDEX IF NOT EXISTS "VerificationAuditEvent_createdAt_idx" ON "VerificationAuditEvent"("createdAt");
CREATE INDEX IF NOT EXISTS "VerificationAuditEvent_action_idx" ON "VerificationAuditEvent"("action");
DO $$ BEGIN
  ALTER TABLE "VerificationAuditEvent" ADD CONSTRAINT "VerificationAuditEvent_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "IdentityVerificationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "VerificationAuditEvent" ADD CONSTRAINT "VerificationAuditEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "messageType" TEXT NOT NULL DEFAULT 'USER';
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "systemEventType" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "replyAllowed" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Message" ALTER COLUMN "senderId" DROP NOT NULL;

UPDATE "User" SET "role" = 'ADMIN' WHERE "isAdmin" = true;

-- Backfill the normalized cache. jsonb_array_elements_text preserves JSON order.
INSERT INTO "ListingImage" ("id", "listingId", "url", "sortOrder", "isCover", "createdAt")
SELECT
  'legacy_' || substr(md5(s."id" || e.ordinality::text || e.url), 1, 24),
  s."id",
  e.url,
  (e.ordinality - 1)::INTEGER,
  e.ordinality = 1,
  CURRENT_TIMESTAMP
FROM "StockListing" s
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(NULLIF(s."images", ''), '[]')::jsonb)
  WITH ORDINALITY AS e(url, ordinality)
ON CONFLICT ("listingId", "url") DO NOTHING;
