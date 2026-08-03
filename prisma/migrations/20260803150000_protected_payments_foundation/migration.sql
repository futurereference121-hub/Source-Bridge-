-- Protected Payments / Stripe Connect foundation (additive, safe).
-- Public UI uses "Protected Payment" — never "escrow".
-- Existing StockListing.paymentOptions defaults to CONTACT_ONLY.

-- AlterTable User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "trustLevel" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "procurementAdvancesEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable StockListing
ALTER TABLE "StockListing" ADD COLUMN IF NOT EXISTS "paymentOptions" TEXT NOT NULL DEFAULT 'CONTACT_ONLY';
ALTER TABLE "StockListing" ADD COLUMN IF NOT EXISTS "inventoryReserved" TEXT NOT NULL DEFAULT '{}';

-- AlterTable Message
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "paymentTicketId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "PlatformPaymentConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "protectionFeeBps" INTEGER NOT NULL DEFAULT 350,
    "protectionFeeFloorMinor" INTEGER NOT NULL DEFAULT 50,
    "sellerServiceFeeBps" INTEGER NOT NULL DEFAULT 0,
    "inspectionHours" INTEGER NOT NULL DEFAULT 48,
    "procurementMinTrustLevel" INTEGER NOT NULL DEFAULT 2,
    "procurementAdvancesGloballyOn" BOOLEAN NOT NULL DEFAULT true,
    "allowedCurrenciesJson" TEXT NOT NULL DEFAULT '["USD"]',
    "stripePlatformCountry" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlatformPaymentConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "StripeConnectAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeAccountId" TEXT NOT NULL,
    "stripeMode" TEXT NOT NULL DEFAULT 'TEST',
    "chargesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "detailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
    "capabilitiesJson" TEXT NOT NULL DEFAULT '{}',
    "requirementsJson" TEXT NOT NULL DEFAULT '{}',
    "country" TEXT NOT NULL DEFAULT '',
    "defaultCurrency" TEXT NOT NULL DEFAULT 'usd',
    "email" TEXT NOT NULL DEFAULT '',
    "disabledReason" TEXT NOT NULL DEFAULT '',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StripeConnectAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProtectedTransaction" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "origin" TEXT NOT NULL,
    "paymentOption" TEXT NOT NULL DEFAULT 'PROTECTED',
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "conversationId" TEXT,
    "listingId" TEXT,
    "title" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "stripeMode" TEXT NOT NULL DEFAULT 'TEST',
    "termsHash" TEXT NOT NULL DEFAULT '',
    "termsVersion" INTEGER NOT NULL DEFAULT 1,
    "itemCostMinor" INTEGER NOT NULL DEFAULT 0,
    "shippingMinor" INTEGER NOT NULL DEFAULT 0,
    "sellerServiceFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "protectionFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "totalChargeMinor" INTEGER NOT NULL DEFAULT 0,
    "procurementAdvanceAgreed" BOOLEAN NOT NULL DEFAULT false,
    "procurementAdvanceMinor" INTEGER NOT NULL DEFAULT 0,
    "procurementTransferredMinor" INTEGER NOT NULL DEFAULT 0,
    "finalTransferredMinor" INTEGER NOT NULL DEFAULT 0,
    "refundedMinor" INTEGER NOT NULL DEFAULT 0,
    "stripePaymentIntentId" TEXT NOT NULL DEFAULT '',
    "stripeCheckoutSessionId" TEXT NOT NULL DEFAULT '',
    "stripeChargeId" TEXT NOT NULL DEFAULT '',
    "sellerConnectAccountId" TEXT NOT NULL DEFAULT '',
    "fundedAt" TIMESTAMP(3),
    "procurementReleasedAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "inspectionEndsAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "selectedSize" TEXT NOT NULL DEFAULT '',
    "trackingProvider" TEXT NOT NULL DEFAULT '',
    "trackingNumber" TEXT NOT NULL DEFAULT '',
    "trackingCarrier" TEXT NOT NULL DEFAULT '',
    "trackingStatus" TEXT NOT NULL DEFAULT '',
    "trackingDeliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProtectedTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PaymentTicket" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "listingId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "termsHash" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "itemCostMinor" INTEGER NOT NULL DEFAULT 0,
    "shippingMinor" INTEGER NOT NULL DEFAULT 0,
    "sellerServiceFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "protectionFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "totalChargeMinor" INTEGER NOT NULL DEFAULT 0,
    "paymentOption" TEXT NOT NULL DEFAULT 'PROTECTED',
    "procurementAdvanceAgreed" BOOLEAN NOT NULL DEFAULT false,
    "procurementAdvanceMinor" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "buyerApprovedRevision" INTEGER,
    "sellerApprovedRevision" INTEGER,
    "buyerApprovedAt" TIMESTAMP(3),
    "sellerApprovedAt" TIMESTAMP(3),
    "declinedById" TEXT,
    "declinedAt" TIMESTAMP(3),
    "declineReason" TEXT NOT NULL DEFAULT '',
    "supersededById" TEXT,
    "protectedTransactionId" TEXT,
    "stripeMode" TEXT NOT NULL DEFAULT 'TEST',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "LedgerEntry" (
    "id" TEXT NOT NULL,
    "protectedTxnId" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "stripeMode" TEXT NOT NULL DEFAULT 'TEST',
    "stripeObjectId" TEXT NOT NULL DEFAULT '',
    "stripeObjectType" TEXT NOT NULL DEFAULT '',
    "idempotencyKey" TEXT NOT NULL,
    "metaJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TransferAttempt" (
    "id" TEXT NOT NULL,
    "protectedTxnId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "stripeMode" TEXT NOT NULL DEFAULT 'TEST',
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "stripeTransferId" TEXT NOT NULL DEFAULT '',
    "failureCode" TEXT NOT NULL DEFAULT '',
    "failureMessage" TEXT NOT NULL DEFAULT '',
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "succeededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TransferAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FinancialAuditEvent" (
    "id" TEXT NOT NULL,
    "protectedTxnId" TEXT,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "metaJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinancialAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TrackingEvent" (
    "id" TEXT NOT NULL,
    "protectedTxnId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerStatus" TEXT NOT NULL DEFAULT '',
    "normalizedStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "rawPayloadJson" TEXT NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackingEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DisputeCase" (
    "id" TEXT NOT NULL,
    "protectedTxnId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL DEFAULT '',
    "details" TEXT NOT NULL DEFAULT '',
    "resolutionNote" TEXT NOT NULL DEFAULT '',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "stripeDisputeId" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DisputeCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProcessedWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL DEFAULT '',
    "stripeMode" TEXT NOT NULL DEFAULT 'TEST',
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProcessedWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- Seed default platform config
INSERT INTO "PlatformPaymentConfig" ("id", "updatedAt", "createdAt")
VALUES ('default', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Indexes
CREATE INDEX IF NOT EXISTS "User_trustLevel_idx" ON "User"("trustLevel");
CREATE INDEX IF NOT EXISTS "StockListing_paymentOptions_idx" ON "StockListing"("paymentOptions");
CREATE INDEX IF NOT EXISTS "Message_paymentTicketId_idx" ON "Message"("paymentTicketId");

CREATE UNIQUE INDEX IF NOT EXISTS "StripeConnectAccount_userId_key" ON "StripeConnectAccount"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "StripeConnectAccount_stripeAccountId_key" ON "StripeConnectAccount"("stripeAccountId");
CREATE INDEX IF NOT EXISTS "StripeConnectAccount_stripeMode_chargesEnabled_payoutsEnabled_idx" ON "StripeConnectAccount"("stripeMode", "chargesEnabled", "payoutsEnabled");

CREATE UNIQUE INDEX IF NOT EXISTS "PaymentTicket_protectedTransactionId_key" ON "PaymentTicket"("protectedTransactionId");
CREATE INDEX IF NOT EXISTS "PaymentTicket_conversationId_createdAt_idx" ON "PaymentTicket"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "PaymentTicket_buyerId_status_idx" ON "PaymentTicket"("buyerId", "status");
CREATE INDEX IF NOT EXISTS "PaymentTicket_sellerId_status_idx" ON "PaymentTicket"("sellerId", "status");
CREATE INDEX IF NOT EXISTS "PaymentTicket_status_updatedAt_idx" ON "PaymentTicket"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "PaymentTicket_termsHash_idx" ON "PaymentTicket"("termsHash");

CREATE INDEX IF NOT EXISTS "ProtectedTransaction_buyerId_status_idx" ON "ProtectedTransaction"("buyerId", "status");
CREATE INDEX IF NOT EXISTS "ProtectedTransaction_sellerId_status_idx" ON "ProtectedTransaction"("sellerId", "status");
CREATE INDEX IF NOT EXISTS "ProtectedTransaction_status_updatedAt_idx" ON "ProtectedTransaction"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "ProtectedTransaction_stripeMode_status_idx" ON "ProtectedTransaction"("stripeMode", "status");
CREATE INDEX IF NOT EXISTS "ProtectedTransaction_stripePaymentIntentId_idx" ON "ProtectedTransaction"("stripePaymentIntentId");
CREATE INDEX IF NOT EXISTS "ProtectedTransaction_conversationId_idx" ON "ProtectedTransaction"("conversationId");
CREATE INDEX IF NOT EXISTS "ProtectedTransaction_listingId_status_idx" ON "ProtectedTransaction"("listingId", "status");
CREATE INDEX IF NOT EXISTS "ProtectedTransaction_inspectionEndsAt_idx" ON "ProtectedTransaction"("inspectionEndsAt");

CREATE UNIQUE INDEX IF NOT EXISTS "LedgerEntry_idempotencyKey_key" ON "LedgerEntry"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "LedgerEntry_protectedTxnId_createdAt_idx" ON "LedgerEntry"("protectedTxnId", "createdAt");
CREATE INDEX IF NOT EXISTS "LedgerEntry_entryType_createdAt_idx" ON "LedgerEntry"("entryType", "createdAt");
CREATE INDEX IF NOT EXISTS "LedgerEntry_stripeObjectId_idx" ON "LedgerEntry"("stripeObjectId");

CREATE UNIQUE INDEX IF NOT EXISTS "TransferAttempt_idempotencyKey_key" ON "TransferAttempt"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "TransferAttempt_protectedTxnId_kind_idx" ON "TransferAttempt"("protectedTxnId", "kind");
CREATE INDEX IF NOT EXISTS "TransferAttempt_status_lastAttemptAt_idx" ON "TransferAttempt"("status", "lastAttemptAt");

CREATE INDEX IF NOT EXISTS "FinancialAuditEvent_protectedTxnId_createdAt_idx" ON "FinancialAuditEvent"("protectedTxnId", "createdAt");
CREATE INDEX IF NOT EXISTS "FinancialAuditEvent_actorUserId_createdAt_idx" ON "FinancialAuditEvent"("actorUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "FinancialAuditEvent_action_createdAt_idx" ON "FinancialAuditEvent"("action", "createdAt");

CREATE INDEX IF NOT EXISTS "TrackingEvent_protectedTxnId_createdAt_idx" ON "TrackingEvent"("protectedTxnId", "createdAt");
CREATE INDEX IF NOT EXISTS "TrackingEvent_normalizedStatus_createdAt_idx" ON "TrackingEvent"("normalizedStatus", "createdAt");

CREATE INDEX IF NOT EXISTS "DisputeCase_protectedTxnId_idx" ON "DisputeCase"("protectedTxnId");
CREATE INDEX IF NOT EXISTS "DisputeCase_status_createdAt_idx" ON "DisputeCase"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "DisputeCase_openedById_idx" ON "DisputeCase"("openedById");

CREATE UNIQUE INDEX IF NOT EXISTS "ProcessedWebhookEvent_provider_eventId_key" ON "ProcessedWebhookEvent"("provider", "eventId");
CREATE INDEX IF NOT EXISTS "ProcessedWebhookEvent_processedAt_idx" ON "ProcessedWebhookEvent"("processedAt");

-- Foreign keys (guarded)
DO $$ BEGIN
  ALTER TABLE "StripeConnectAccount" ADD CONSTRAINT "StripeConnectAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProtectedTransaction" ADD CONSTRAINT "ProtectedTransaction_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProtectedTransaction" ADD CONSTRAINT "ProtectedTransaction_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProtectedTransaction" ADD CONSTRAINT "ProtectedTransaction_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProtectedTransaction" ADD CONSTRAINT "ProtectedTransaction_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "StockListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PaymentTicket" ADD CONSTRAINT "PaymentTicket_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PaymentTicket" ADD CONSTRAINT "PaymentTicket_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PaymentTicket" ADD CONSTRAINT "PaymentTicket_protectedTransactionId_fkey" FOREIGN KEY ("protectedTransactionId") REFERENCES "ProtectedTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_paymentTicketId_fkey" FOREIGN KEY ("paymentTicketId") REFERENCES "PaymentTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_protectedTxnId_fkey" FOREIGN KEY ("protectedTxnId") REFERENCES "ProtectedTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TransferAttempt" ADD CONSTRAINT "TransferAttempt_protectedTxnId_fkey" FOREIGN KEY ("protectedTxnId") REFERENCES "ProtectedTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "FinancialAuditEvent" ADD CONSTRAINT "FinancialAuditEvent_protectedTxnId_fkey" FOREIGN KEY ("protectedTxnId") REFERENCES "ProtectedTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "FinancialAuditEvent" ADD CONSTRAINT "FinancialAuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "TrackingEvent" ADD CONSTRAINT "TrackingEvent_protectedTxnId_fkey" FOREIGN KEY ("protectedTxnId") REFERENCES "ProtectedTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DisputeCase" ADD CONSTRAINT "DisputeCase_protectedTxnId_fkey" FOREIGN KEY ("protectedTxnId") REFERENCES "ProtectedTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "DisputeCase" ADD CONSTRAINT "DisputeCase_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
