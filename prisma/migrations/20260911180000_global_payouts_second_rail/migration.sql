-- Additive Global Payouts second rail. Safe defaults preserve Connect behaviour.
-- Local/generate only — do NOT apply to production/shared DB without explicit approval.

-- AlterTable
ALTER TABLE "ProtectedTransaction" ADD COLUMN "payoutRail" TEXT NOT NULL DEFAULT 'STRIPE_CONNECT';
ALTER TABLE "ProtectedTransaction" ADD COLUMN "payoutRailLockedAt" TIMESTAMP(3);
ALTER TABLE "ProtectedTransaction" ADD COLUMN "sellerGpRecipientId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ProtectedTransaction" ADD COLUMN "sellerGpPayoutMethodId" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "ProtectedTransaction_payoutRail_status_idx" ON "ProtectedTransaction"("payoutRail", "status");

-- CreateTable
CREATE TABLE "GlobalPayoutRecipient" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeMode" TEXT NOT NULL DEFAULT 'TEST',
    "stripeRecipientId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "country" TEXT NOT NULL DEFAULT '',
    "defaultCurrency" TEXT NOT NULL DEFAULT '',
    "defaultPayoutMethodId" TEXT NOT NULL DEFAULT '',
    "payoutMethodReady" BOOLEAN NOT NULL DEFAULT false,
    "recipientType" TEXT NOT NULL DEFAULT 'individual',
    "capabilitiesJson" TEXT NOT NULL DEFAULT '{}',
    "requirementsJson" TEXT NOT NULL DEFAULT '{}',
    "disabledReason" TEXT NOT NULL DEFAULT '',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalPayoutRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GlobalPayoutRecipient_stripeRecipientId_key" ON "GlobalPayoutRecipient"("stripeRecipientId");
CREATE UNIQUE INDEX "GlobalPayoutRecipient_userId_stripeMode_key" ON "GlobalPayoutRecipient"("userId", "stripeMode");
CREATE INDEX "GlobalPayoutRecipient_stripeMode_status_payoutMethodReady_idx" ON "GlobalPayoutRecipient"("stripeMode", "status", "payoutMethodReady");
CREATE INDEX "GlobalPayoutRecipient_userId_idx" ON "GlobalPayoutRecipient"("userId");
CREATE INDEX "GlobalPayoutRecipient_country_idx" ON "GlobalPayoutRecipient"("country");

-- AddForeignKey
ALTER TABLE "GlobalPayoutRecipient" ADD CONSTRAINT "GlobalPayoutRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "OutboundPaymentAttempt" (
    "id" TEXT NOT NULL,
    "protectedTxnId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "destinationCurrency" TEXT NOT NULL DEFAULT '',
    "destinationAmountMinor" INTEGER NOT NULL DEFAULT 0,
    "stripeMode" TEXT NOT NULL DEFAULT 'TEST',
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "stripeOutboundPaymentId" TEXT NOT NULL DEFAULT '',
    "stripeFinancialAccountId" TEXT NOT NULL DEFAULT '',
    "stripeRecipientId" TEXT NOT NULL DEFAULT '',
    "stripePayoutMethodId" TEXT NOT NULL DEFAULT '',
    "providerFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "crossBorderFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "fxFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "fxRateSnapshot" TEXT NOT NULL DEFAULT '',
    "failureCode" TEXT NOT NULL DEFAULT '',
    "failureMessage" TEXT NOT NULL DEFAULT '',
    "reconciliationNote" TEXT NOT NULL DEFAULT '',
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "lastAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "initiatedAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "succeededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutboundPaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutboundPaymentAttempt_idempotencyKey_key" ON "OutboundPaymentAttempt"("idempotencyKey");
CREATE INDEX "OutboundPaymentAttempt_protectedTxnId_kind_idx" ON "OutboundPaymentAttempt"("protectedTxnId", "kind");
CREATE INDEX "OutboundPaymentAttempt_status_lastAttemptAt_idx" ON "OutboundPaymentAttempt"("status", "lastAttemptAt");
CREATE INDEX "OutboundPaymentAttempt_stripeOutboundPaymentId_idx" ON "OutboundPaymentAttempt"("stripeOutboundPaymentId");
CREATE INDEX "OutboundPaymentAttempt_stripeMode_status_idx" ON "OutboundPaymentAttempt"("stripeMode", "status");

-- AddForeignKey
ALTER TABLE "OutboundPaymentAttempt" ADD CONSTRAINT "OutboundPaymentAttempt_protectedTxnId_fkey" FOREIGN KEY ("protectedTxnId") REFERENCES "ProtectedTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
