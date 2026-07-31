-- Additive: demo showcase flag + one profile video per user.
-- Safe for production; does not delete or alter existing rows beyond defaults.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isDemo" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileVideoUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileVideoPosterUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileVideoPathname" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileVideoPosterPathname" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileVideoMime" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileVideoDurationSec" INTEGER;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileVideoSizeBytes" INTEGER;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileVideoCaption" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileVideoUpdatedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "User_isDemo_idx" ON "User"("isDemo");
CREATE INDEX IF NOT EXISTS "User_username_idx" ON "User"("username");
