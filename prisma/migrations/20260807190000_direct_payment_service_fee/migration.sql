-- Direct Payment platform service fee (separate from Protection Fee).
-- Non-destructive: defaults match protection rates for safe rollout.

ALTER TABLE "PlatformPaymentConfig"
ADD COLUMN IF NOT EXISTS "directServiceFeeBps" INTEGER NOT NULL DEFAULT 350;

ALTER TABLE "PlatformPaymentConfig"
ADD COLUMN IF NOT EXISTS "directServiceFeeFloorMinor" INTEGER NOT NULL DEFAULT 50;
