-- Per-user inbox hide (P7)
ALTER TABLE "ConversationParticipant" ADD COLUMN "hiddenAt" TIMESTAMP(3);

-- Platform fee included in quoted price (P11)
ALTER TABLE "PaymentTicket" ADD COLUMN "platformFeeIncludedInPrice" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "ConversationParticipant_userId_hiddenAt_idx" ON "ConversationParticipant"("userId", "hiddenAt");
