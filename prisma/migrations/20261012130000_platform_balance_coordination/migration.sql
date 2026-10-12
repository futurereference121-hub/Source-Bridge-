-- Coordination and bank-remainder attempts for a manual platform payout schedule.
-- No payout schedule change and no backfill of existing purchases.

CREATE TABLE "PlatformBalanceCoordination" (
    "id" TEXT NOT NULL,
    "stripeMode" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "lockToken" TEXT NOT NULL DEFAULT '',
    "fence" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "lastStartedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorCode" TEXT NOT NULL DEFAULT '',
    "readinessCheckedAt" TIMESTAMP(3),
    "readinessCode" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformBalanceCoordination_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformBalanceCoordination_stripeMode_currency_key" ON "PlatformBalanceCoordination"("stripeMode", "currency");

CREATE TABLE "PlatformBankPayoutAttempt" (
    "id" TEXT NOT NULL,
    "stripeMode" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "destinationId" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "stripePayoutId" TEXT NOT NULL DEFAULT '',
    "failureCode" TEXT NOT NULL DEFAULT '',
    "failureMessage" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "postedAt" TIMESTAMP(3),

    CONSTRAINT "PlatformBankPayoutAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformBankPayoutAttempt_idempotencyKey_key" ON "PlatformBankPayoutAttempt"("idempotencyKey");
CREATE UNIQUE INDEX "PlatformBankPayoutAttempt_stripeMode_currency_sequence_key" ON "PlatformBankPayoutAttempt"("stripeMode", "currency", "sequence");
CREATE INDEX "PlatformBankPayoutAttempt_stripeMode_currency_status_idx" ON "PlatformBankPayoutAttempt"("stripeMode", "currency", "status");
CREATE INDEX "PlatformBankPayoutAttempt_stripePayoutId_idx" ON "PlatformBankPayoutAttempt"("stripePayoutId");
