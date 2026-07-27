-- Additive migration: clothing listing fields + messaging + transactions + review linkage.
-- Preserves existing users, listings, statuses, opportunities, and reviews.

-- StockListing clothing / shipping fields
ALTER TABLE "StockListing" ADD COLUMN IF NOT EXISTS "productKind" TEXT NOT NULL DEFAULT 'clothing';
ALTER TABLE "StockListing" ADD COLUMN IF NOT EXISTS "subcategory" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StockListing" ADD COLUMN IF NOT EXISTS "sizes" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "StockListing" ADD COLUMN IF NOT EXISTS "material" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StockListing" ADD COLUMN IF NOT EXISTS "brand" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StockListing" ADD COLUMN IF NOT EXISTS "condition" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StockListing" ADD COLUMN IF NOT EXISTS "colour" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StockListing" ADD COLUMN IF NOT EXISTS "pattern" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StockListing" ADD COLUMN IF NOT EXISTS "fit" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StockListing" ADD COLUMN IF NOT EXISTS "gender" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StockListing" ADD COLUMN IF NOT EXISTS "shipFromCity" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StockListing" ADD COLUMN IF NOT EXISTS "shipFromCountry" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StockListing" ADD COLUMN IF NOT EXISTS "shippingAvailable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StockListing" ADD COLUMN IF NOT EXISTS "attributes" TEXT NOT NULL DEFAULT '{}';

-- Backfill ship-from from legacy location when possible (city-only copy)
UPDATE "StockListing"
SET "shipFromCity" = "location"
WHERE "shipFromCity" = '' AND "location" <> '';

CREATE INDEX IF NOT EXISTS "StockListing_slug_idx" ON "StockListing"("slug");
CREATE INDEX IF NOT EXISTS "StockListing_productKind_category_idx" ON "StockListing"("productKind", "category");

-- Messaging
CREATE TABLE IF NOT EXISTS "Conversation" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "contextType" TEXT NOT NULL DEFAULT 'direct',
    "listingId" TEXT,
    "opportunityId" TEXT,
    "tripId" TEXT,
    "sourcingRequestId" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMP(3),
    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_sourcingRequestId_key" ON "Conversation"("sourcingRequestId");
CREATE INDEX IF NOT EXISTS "Conversation_updatedAt_idx" ON "Conversation"("updatedAt");
CREATE INDEX IF NOT EXISTS "Conversation_listingId_idx" ON "Conversation"("listingId");
CREATE INDEX IF NOT EXISTS "Conversation_opportunityId_idx" ON "Conversation"("opportunityId");
CREATE INDEX IF NOT EXISTS "Conversation_lastMessageAt_idx" ON "Conversation"("lastMessageAt");

CREATE TABLE IF NOT EXISTS "ConversationParticipant" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    CONSTRAINT "ConversationParticipant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ConversationParticipant_conversationId_userId_key" ON "ConversationParticipant"("conversationId", "userId");
CREATE INDEX IF NOT EXISTS "ConversationParticipant_userId_lastReadAt_idx" ON "ConversationParticipant"("userId", "lastReadAt");

CREATE TABLE IF NOT EXISTS "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "Message_senderId_idx" ON "Message"("senderId");

CREATE TABLE IF NOT EXISTS "MessageAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "pathname" TEXT NOT NULL DEFAULT '',
    "mimeType" TEXT NOT NULL DEFAULT '',
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MessageAttachment_messageId_idx" ON "MessageAttachment"("messageId");

CREATE TABLE IF NOT EXISTS "ConversationBlock" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConversationBlock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ConversationBlock_conversationId_userId_key" ON "ConversationBlock"("conversationId", "userId");

CREATE TABLE IF NOT EXISTS "SourcingRequest" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "listingId" TEXT,
    "opportunityId" TEXT,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SourcingRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SourcingRequest_fromUserId_toUserId_idx" ON "SourcingRequest"("fromUserId", "toUserId");
CREATE INDEX IF NOT EXISTS "SourcingRequest_toUserId_createdAt_idx" ON "SourcingRequest"("toUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "SourcingRequest_listingId_idx" ON "SourcingRequest"("listingId");
CREATE INDEX IF NOT EXISTS "SourcingRequest_opportunityId_idx" ON "SourcingRequest"("opportunityId");

CREATE TABLE IF NOT EXISTS "Transaction" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "conversationId" TEXT,
    "sourcingRequestId" TEXT,
    "listingId" TEXT,
    "opportunityId" TEXT,
    "title" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "amount" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Transaction_buyerId_status_idx" ON "Transaction"("buyerId", "status");
CREATE INDEX IF NOT EXISTS "Transaction_sellerId_status_idx" ON "Transaction"("sellerId", "status");
CREATE INDEX IF NOT EXISTS "Transaction_conversationId_idx" ON "Transaction"("conversationId");
CREATE INDEX IF NOT EXISTS "Transaction_status_completedAt_idx" ON "Transaction"("status", "completedAt");

-- Review ↔ transaction linkage (additive)
ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "transactionId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Review_transactionId_reviewerId_key" ON "Review"("transactionId", "reviewerId");
CREATE INDEX IF NOT EXISTS "Review_transactionId_idx" ON "Review"("transactionId");

-- Foreign keys (safe if re-run: only add when missing via DO blocks)
DO $$ BEGIN
  ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "StockListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_sourcingRequestId_fkey" FOREIGN KEY ("sourcingRequestId") REFERENCES "SourcingRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ConversationBlock" ADD CONSTRAINT "ConversationBlock_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ConversationBlock" ADD CONSTRAINT "ConversationBlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SourcingRequest" ADD CONSTRAINT "SourcingRequest_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SourcingRequest" ADD CONSTRAINT "SourcingRequest_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SourcingRequest" ADD CONSTRAINT "SourcingRequest_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "StockListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SourcingRequest" ADD CONSTRAINT "SourcingRequest_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_sourcingRequestId_fkey" FOREIGN KEY ("sourcingRequestId") REFERENCES "SourcingRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "StockListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Review" ADD CONSTRAINT "Review_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
