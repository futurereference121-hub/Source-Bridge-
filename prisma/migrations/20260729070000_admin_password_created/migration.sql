-- Add adminPasswordCreated flag to track whether adminsource has set its initial password.
-- Safe additive migration – no data is destroyed.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adminPasswordCreated" BOOLEAN NOT NULL DEFAULT false;
