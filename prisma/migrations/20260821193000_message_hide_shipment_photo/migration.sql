-- Per-user "Delete for me" on messages (shared row retained for other participants).
CREATE TABLE "MessageHide" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hiddenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageHide_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageHide_messageId_userId_key" ON "MessageHide"("messageId", "userId");
CREATE INDEX "MessageHide_userId_messageId_idx" ON "MessageHide"("userId", "messageId");

ALTER TABLE "MessageHide" ADD CONSTRAINT "MessageHide_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageHide" ADD CONSTRAINT "MessageHide_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Durable shipping-proof URL for Product Purchase tickets (buyer reveal/hide).
ALTER TABLE "ProtectedTransaction" ADD COLUMN "shipmentPhotoUrl" TEXT NOT NULL DEFAULT '';
