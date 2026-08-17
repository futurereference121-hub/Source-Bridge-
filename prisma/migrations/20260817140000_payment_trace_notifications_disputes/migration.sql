-- Payment ticket propose idempotency (client proposalTraceId).
ALTER TABLE "PaymentTicket" ADD COLUMN "proposalTraceId" TEXT;

CREATE UNIQUE INDEX "PaymentTicket_proposalTraceId_key" ON "PaymentTicket"("proposalTraceId");

-- Notification dedupe for payment lifecycle events.
ALTER TABLE "Notification" ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- Admin dispute workflow fields.
ALTER TABLE "DisputeCase" ADD COLUMN "category" TEXT NOT NULL DEFAULT '';
ALTER TABLE "DisputeCase" ADD COLUMN "adminNotes" TEXT NOT NULL DEFAULT '';
