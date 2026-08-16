-- Authoritative last meaningful Payment Ticket activity (not chat poll / GET).
-- Used for 72-hour unfunded expiry. Existing rows inherit updatedAt.
ALTER TABLE "PaymentTicket"
  ADD COLUMN "lastMeaningfulActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "PaymentTicket"
SET "lastMeaningfulActivityAt" = "updatedAt";

CREATE INDEX "PaymentTicket_status_lastMeaningfulActivityAt_idx"
  ON "PaymentTicket"("status", "lastMeaningfulActivityAt");
