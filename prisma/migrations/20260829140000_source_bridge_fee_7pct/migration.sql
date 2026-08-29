-- Source Bridge platform fee: 2% (200 bps) → 7% (700 bps).
-- Floor remains 0 (pure percentage, no minimum fee).
-- Does NOT mutate ProtectedTransaction / PaymentTicket stored fee amounts.
-- Historical funded/completed deals keep the fee stored at creation.

ALTER TABLE "PlatformPaymentConfig"
  ALTER COLUMN "protectionFeeBps" SET DEFAULT 700;

ALTER TABLE "PlatformPaymentConfig"
  ALTER COLUMN "directServiceFeeBps" SET DEFAULT 700;

-- Update singleton only when it still carries the prior product defaults (2%).
UPDATE "PlatformPaymentConfig"
SET
  "protectionFeeBps" = 700,
  "directServiceFeeBps" = 700,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'default'
  AND "protectionFeeBps" = 200
  AND "directServiceFeeBps" = 200;
