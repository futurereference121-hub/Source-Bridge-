-- Admin Dashboard confirmation of the TEST platform GBP bank.
-- Not a Stripe API verification, and no payout or bank change.

CREATE TABLE "PlatformBankDashboardConfirmation" (
    "id" TEXT NOT NULL,
    "stripeMode" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "stripeAccountHash" TEXT NOT NULL,
    "accountSuffix" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "confirmedByHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformBankDashboardConfirmation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformBankDashboardConfirmation_stripeMode_currency_stripeAccountHash_key" ON "PlatformBankDashboardConfirmation"("stripeMode", "currency", "stripeAccountHash");
