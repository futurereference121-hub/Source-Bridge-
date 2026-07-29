-- Additive: discoverability, test accounts, soft-delete, notification prefs,
-- password-reset tokens, notifications, deletion audit, storage cleanup.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isDiscoverable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isTestAccount" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "notificationSoundsEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "notificationVolume" TEXT NOT NULL DEFAULT 'medium';

CREATE INDEX IF NOT EXISTS "User_isDiscoverable_deletedAt_isTestAccount_idx"
  ON "User"("isDiscoverable", "deletedAt", "isTestAccount");
CREATE INDEX IF NOT EXISTS "User_role_isAdmin_idx" ON "User"("role", "isAdmin");
CREATE INDEX IF NOT EXISTS "User_deletedAt_idx" ON "User"("deletedAt");

-- Hide designated admin from public discovery
UPDATE "User"
SET "isDiscoverable" = false, "role" = 'ADMIN', "isAdmin" = true
WHERE lower(username) = 'adminsource' OR lower(email) LIKE 'adminsource@%';

CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
CREATE INDEX IF NOT EXISTS "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

DO $$ BEGIN
  ALTER TABLE "PasswordResetToken"
    ADD CONSTRAINT "PasswordResetToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "Notification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT '',
  "body" TEXT NOT NULL DEFAULT '',
  "href" TEXT NOT NULL DEFAULT '',
  "actorId" TEXT,
  "actorName" TEXT NOT NULL DEFAULT '',
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");
CREATE INDEX IF NOT EXISTS "Notification_userId_type_createdAt_idx" ON "Notification"("userId", "type", "createdAt");

DO $$ BEGIN
  ALTER TABLE "Notification"
    ADD CONSTRAINT "Notification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "AccountDeletionAudit" (
  "id" TEXT NOT NULL,
  "formerUserIdHash" TEXT NOT NULL,
  "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "storageCleanupOk" BOOLEAN NOT NULL DEFAULT false,
  "storageCleanupNote" TEXT NOT NULL DEFAULT '',
  "meta" TEXT NOT NULL DEFAULT '{}',
  CONSTRAINT "AccountDeletionAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AccountDeletionAudit_deletedAt_idx" ON "AccountDeletionAudit"("deletedAt");

CREATE TABLE IF NOT EXISTS "StorageCleanupJob" (
  "id" TEXT NOT NULL,
  "urlOrPath" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'blob',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT NOT NULL DEFAULT '',
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StorageCleanupJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "StorageCleanupJob_completedAt_createdAt_idx"
  ON "StorageCleanupJob"("completedAt", "createdAt");
