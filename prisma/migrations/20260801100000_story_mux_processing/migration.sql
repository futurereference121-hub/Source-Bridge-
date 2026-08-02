-- Story media pipeline: Mux direct upload + async transcode.
-- Additive only. Existing ACTIVE Blob clips keep playing until natural expiry.

-- AlterTable
ALTER TABLE "StoryClip" ADD COLUMN IF NOT EXISTS "mediaProvider" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StoryClip" ADD COLUMN IF NOT EXISTS "muxUploadId" TEXT;
ALTER TABLE "StoryClip" ADD COLUMN IF NOT EXISTS "muxAssetId" TEXT;
ALTER TABLE "StoryClip" ADD COLUMN IF NOT EXISTS "muxPlaybackId" TEXT;
ALTER TABLE "StoryClip" ADD COLUMN IF NOT EXISTS "processingError" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StoryClip" ADD COLUMN IF NOT EXISTS "readyAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "StoryClip_muxUploadId_key" ON "StoryClip"("muxUploadId");
CREATE INDEX IF NOT EXISTS "StoryClip_muxAssetId_idx" ON "StoryClip"("muxAssetId");

-- Backfill: every pre-existing clip was stored directly on Vercel Blob.
UPDATE "StoryClip" SET "mediaProvider" = 'blob' WHERE "mediaProvider" = '';
