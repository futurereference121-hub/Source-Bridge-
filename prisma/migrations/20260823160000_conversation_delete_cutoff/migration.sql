-- AlterTable
ALTER TABLE "ConversationParticipant" ADD COLUMN IF NOT EXISTS "deletedBeforeAt" TIMESTAMP(3);
