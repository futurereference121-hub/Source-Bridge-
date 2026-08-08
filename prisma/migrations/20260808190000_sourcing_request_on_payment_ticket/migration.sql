-- Optional link from Payment Ticket / Protected Transaction to Sourcing Request.
-- Prevents simultaneous active/funded agreements per request (enforced in app).

ALTER TABLE "PaymentTicket" ADD COLUMN IF NOT EXISTS "sourcingRequestId" TEXT;
ALTER TABLE "ProtectedTransaction" ADD COLUMN IF NOT EXISTS "sourcingRequestId" TEXT;

CREATE INDEX IF NOT EXISTS "PaymentTicket_sourcingRequestId_status_idx"
  ON "PaymentTicket"("sourcingRequestId", "status");

CREATE INDEX IF NOT EXISTS "ProtectedTransaction_sourcingRequestId_status_idx"
  ON "ProtectedTransaction"("sourcingRequestId", "status");
