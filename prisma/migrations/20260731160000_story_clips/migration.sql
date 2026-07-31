-- Stories system: ephemeral location clips (24h), views, reports.
-- Permanent profileVideo User columns remain for safe rollback; UI no longer uses them.

CREATE TABLE IF NOT EXISTS "StoryClip" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "videoUrl" TEXT NOT NULL,
    "blobPathname" TEXT NOT NULL DEFAULT '',
    "thumbnailUrl" TEXT NOT NULL DEFAULT '',
    "thumbnailBlobPathname" TEXT NOT NULL DEFAULT '',
    "durationSeconds" INTEGER NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL DEFAULT 0,
    "mimeType" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "originalFilename" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StoryClip_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StoryView" (
    "id" TEXT NOT NULL,
    "storyClipId" TEXT NOT NULL,
    "viewerUserId" TEXT,
    "anonymousSessionHash" TEXT,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryView_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StoryReport" (
    "id" TEXT NOT NULL,
    "storyClipId" TEXT NOT NULL,
    "reporterUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StoryClip_userId_status_expiresAt_idx" ON "StoryClip"("userId", "status", "expiresAt");
CREATE INDEX IF NOT EXISTS "StoryClip_expiresAt_idx" ON "StoryClip"("expiresAt");
CREATE INDEX IF NOT EXISTS "StoryClip_userId_createdAt_idx" ON "StoryClip"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "StoryClip_status_expiresAt_idx" ON "StoryClip"("status", "expiresAt");

CREATE UNIQUE INDEX IF NOT EXISTS "StoryView_storyClipId_viewerUserId_key" ON "StoryView"("storyClipId", "viewerUserId");
CREATE INDEX IF NOT EXISTS "StoryView_storyClipId_viewedAt_idx" ON "StoryView"("storyClipId", "viewedAt");
CREATE INDEX IF NOT EXISTS "StoryView_viewerUserId_viewedAt_idx" ON "StoryView"("viewerUserId", "viewedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "StoryReport_storyClipId_reporterUserId_key" ON "StoryReport"("storyClipId", "reporterUserId");
CREATE INDEX IF NOT EXISTS "StoryReport_storyClipId_createdAt_idx" ON "StoryReport"("storyClipId", "createdAt");
CREATE INDEX IF NOT EXISTS "StoryReport_status_createdAt_idx" ON "StoryReport"("status", "createdAt");

DO $$ BEGIN
  ALTER TABLE "StoryClip" ADD CONSTRAINT "StoryClip_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "StoryView" ADD CONSTRAINT "StoryView_storyClipId_fkey"
    FOREIGN KEY ("storyClipId") REFERENCES "StoryClip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "StoryView" ADD CONSTRAINT "StoryView_viewerUserId_fkey"
    FOREIGN KEY ("viewerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "StoryReport" ADD CONSTRAINT "StoryReport_storyClipId_fkey"
    FOREIGN KEY ("storyClipId") REFERENCES "StoryClip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "StoryReport" ADD CONSTRAINT "StoryReport_reporterUserId_fkey"
    FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
