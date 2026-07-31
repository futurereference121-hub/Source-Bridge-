-- Additive: canonical 1:1 conversation pair key.
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "pairKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_pairKey_key" ON "Conversation"("pairKey");
