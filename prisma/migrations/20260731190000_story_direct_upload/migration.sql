-- AlterTable
ALTER TABLE "StoryClip" ADD COLUMN IF NOT EXISTS "uploadSessionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "StoryClip_uploadSessionId_key" ON "StoryClip"("uploadSessionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "StoryClip_userId_blobPathname_idx" ON "StoryClip"("userId", "blobPathname");
