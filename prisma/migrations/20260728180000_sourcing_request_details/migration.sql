-- Additive messaging / sourcing request fields. Safe for Neon — no reset.

ALTER TABLE "SourcingRequest" ADD COLUMN IF NOT EXISTS "neededFrom" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SourcingRequest" ADD COLUMN IF NOT EXISTS "budget" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SourcingRequest" ADD COLUMN IF NOT EXISTS "deadline" TEXT NOT NULL DEFAULT '';
ALTER TABLE "SourcingRequest" ADD COLUMN IF NOT EXISTS "referenceImages" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "SourcingRequest" ADD COLUMN IF NOT EXISTS "clientRequestId" TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS "SourcingRequest_fromUserId_clientRequestId_idx"
  ON "SourcingRequest"("fromUserId", "clientRequestId");

-- Unique only when clientRequestId is non-empty (Postgres partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS "SourcingRequest_fromUserId_clientRequestId_key"
  ON "SourcingRequest"("fromUserId", "clientRequestId")
  WHERE "clientRequestId" <> '';

ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP(3);
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "clientMessageId" TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS "Message_conversationId_clientMessageId_idx"
  ON "Message"("conversationId", "clientMessageId");
