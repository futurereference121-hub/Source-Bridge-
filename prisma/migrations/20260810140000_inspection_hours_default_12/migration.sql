-- Default inspection window: 48h → 12h.
-- Does NOT rewrite ProtectedTransaction.inspectionEndsAt (live timers stay intact).
ALTER TABLE "PlatformPaymentConfig"
  ALTER COLUMN "inspectionHours" SET DEFAULT 12;

-- Only bump the platform singleton when it still carries the historical product default.
UPDATE "PlatformPaymentConfig"
SET "inspectionHours" = 12,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'default'
  AND "inspectionHours" = 48;
