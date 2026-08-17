-- Generic archive: hide a Payment Ticket from chat and the active cap
-- without deleting PaymentTicket / ProtectedTransaction / Stripe money rows.
ALTER TABLE "PaymentTicket"
  ADD COLUMN "hiddenFromChatAt" TIMESTAMP(3);

CREATE INDEX "PaymentTicket_hiddenFromChatAt_idx"
  ON "PaymentTicket"("hiddenFromChatAt");
