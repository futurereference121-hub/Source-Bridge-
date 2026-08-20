-- Monotonic conversation activity for reliable poll short-circuit (P1)
ALTER TABLE "Conversation" ADD COLUMN "activityVersion" INTEGER NOT NULL DEFAULT 0;

-- Track SB fee portion refunded separately from buyer item refund (P19)
ALTER TABLE "ProtectedTransaction" ADD COLUMN "platformFeeRefundedMinor" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Conversation_activityVersion_idx" ON "Conversation"("activityVersion");
