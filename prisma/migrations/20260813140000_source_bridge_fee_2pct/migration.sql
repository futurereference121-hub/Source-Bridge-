-- Source Bridge platform fee: 3.5% (350 bps) → 2% (200 bps).
-- Floors: 50 → 0 so pure 2% matches product decision ($20 → $0.40).
-- Does NOT mutate ProtectedTransaction / PaymentTicket stored fee amounts.

ALTER TABLE "PlatformPaymentConfig"
  ALTER COLUMN "protectionFeeBps" SET DEFAULT 200;

ALTER TABLE "PlatformPaymentConfig"
  ALTER COLUMN "protectionFeeFloorMinor" SET DEFAULT 0;

ALTER TABLE "PlatformPaymentConfig"
  ALTER COLUMN "directServiceFeeBps" SET DEFAULT 200;

ALTER TABLE "PlatformPaymentConfig"
  ALTER COLUMN "directServiceFeeFloorMinor" SET DEFAULT 0;

-- Update singleton only when it still carries the prior product defaults.
UPDATE "PlatformPaymentConfig"
SET
  "protectionFeeBps" = 200,
  "protectionFeeFloorMinor" = 0,
  "directServiceFeeBps" = 200,
  "directServiceFeeFloorMinor" = 0,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'default'
  AND "protectionFeeBps" = 350
  AND "directServiceFeeBps" = 350;
