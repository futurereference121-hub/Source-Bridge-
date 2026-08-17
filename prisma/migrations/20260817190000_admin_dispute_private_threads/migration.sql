-- Private Admin↔Buyer and Admin↔Sourcer threads, linked to a dispute case.
-- pairKey remains unique; admin threads use admin-dispute:{disputeId}:{BUYER|SELLER}.

ALTER TABLE "Conversation" ADD COLUMN "disputeCaseId" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "paymentTicketId" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "adminPartyRole" TEXT;

CREATE UNIQUE INDEX "Conversation_disputeCaseId_adminPartyRole_key" ON "Conversation"("disputeCaseId", "adminPartyRole");
CREATE INDEX "Conversation_disputeCaseId_idx" ON "Conversation"("disputeCaseId");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_disputeCaseId_fkey" FOREIGN KEY ("disputeCaseId") REFERENCES "DisputeCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
