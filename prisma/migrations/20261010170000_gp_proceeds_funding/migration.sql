-- Seller payout bank-arrival estimate, stored only when Stripe provides one.
ALTER TABLE "OutboundPaymentAttempt" ADD COLUMN "expectedArrivalAt" TIMESTAMP(3);

-- Global Payouts proceeds funding: one record per protected transaction,
-- and one idempotent payout leg per transfer into the financial account.

CREATE TABLE "GpProceedsFunding" (
    "id" TEXT NOT NULL,
    "protectedTxnId" TEXT NOT NULL,
    "stripeMode" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL DEFAULT '',
    "balanceTransactionId" TEXT NOT NULL DEFAULT '',
    "principalMinor" INTEGER NOT NULL,
    "payoutFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "chargeNetMinor" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'AWAITING_SETTLEMENT',
    "availableOn" TIMESTAMP(3),
    "failureCode" TEXT NOT NULL DEFAULT '',
    "failureMessage" TEXT NOT NULL DEFAULT '',
    "quoteIdempotencyKey" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GpProceedsFunding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GpProceedsFunding_protectedTxnId_key" ON "GpProceedsFunding"("protectedTxnId");
CREATE INDEX "GpProceedsFunding_status_availableOn_idx" ON "GpProceedsFunding"("status", "availableOn");
CREATE INDEX "GpProceedsFunding_stripeMode_status_idx" ON "GpProceedsFunding"("stripeMode", "status");
CREATE INDEX "GpProceedsFunding_chargeId_idx" ON "GpProceedsFunding"("chargeId");

ALTER TABLE "GpProceedsFunding" ADD CONSTRAINT "GpProceedsFunding_protectedTxnId_fkey" FOREIGN KEY ("protectedTxnId") REFERENCES "ProtectedTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "GpProceedsFundingLeg" (
    "id" TEXT NOT NULL,
    "fundingId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "stripePayoutId" TEXT NOT NULL DEFAULT '',
    "stripePayoutStatus" TEXT NOT NULL DEFAULT '',
    "faCreditId" TEXT NOT NULL DEFAULT '',
    "failureCode" TEXT NOT NULL DEFAULT '',
    "failureMessage" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "postedAt" TIMESTAMP(3),

    CONSTRAINT "GpProceedsFundingLeg_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GpProceedsFundingLeg_idempotencyKey_key" ON "GpProceedsFundingLeg"("idempotencyKey");
CREATE UNIQUE INDEX "GpProceedsFundingLeg_fundingId_sequence_key" ON "GpProceedsFundingLeg"("fundingId", "sequence");
CREATE INDEX "GpProceedsFundingLeg_status_idx" ON "GpProceedsFundingLeg"("status");
CREATE INDEX "GpProceedsFundingLeg_stripePayoutId_idx" ON "GpProceedsFundingLeg"("stripePayoutId");
CREATE INDEX "GpProceedsFundingLeg_faCreditId_idx" ON "GpProceedsFundingLeg"("faCreditId");

ALTER TABLE "GpProceedsFundingLeg" ADD CONSTRAINT "GpProceedsFundingLeg_fundingId_fkey" FOREIGN KEY ("fundingId") REFERENCES "GpProceedsFunding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
