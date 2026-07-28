-- Additive: listing saleStatus, transaction payment fields, seller payment methods.
-- Preserves existing users, listings, messages, and activity.

ALTER TABLE "StockListing" ADD COLUMN IF NOT EXISTS "saleStatus" TEXT NOT NULL DEFAULT 'AVAILABLE';
CREATE INDEX IF NOT EXISTS "StockListing_saleStatus_idx" ON "StockListing"("saleStatus");
CREATE INDEX IF NOT EXISTS "StockListing_userId_saleStatus_idx" ON "StockListing"("userId", "saleStatus");

-- Helpful indexes for Explore / incomplete-profile filters
CREATE INDEX IF NOT EXISTS "User_onboardingComplete_emailVerified_idx" ON "User"("onboardingComplete", "emailVerified");
CREATE INDEX IF NOT EXISTS "User_slug_idx" ON "User"("slug");

ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid';
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "selectedSize" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "stripeCheckoutSessionId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "stripePaymentIntentId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "cryptoNetwork" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "cryptoWalletAddress" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "cryptoTransactionHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "buyerConfirmed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "sellerConfirmed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "escrowStatus" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "platformFeeAmount" DOUBLE PRECISION;
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "sellerPayoutStatus" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "paymentMethodId" TEXT;

CREATE INDEX IF NOT EXISTS "Transaction_paymentStatus_idx" ON "Transaction"("paymentStatus");
CREATE INDEX IF NOT EXISTS "Transaction_listingId_paymentStatus_idx" ON "Transaction"("listingId", "paymentStatus");

CREATE TABLE IF NOT EXISTS "SellerPaymentMethod" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "networkName" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "qrImageUrl" TEXT NOT NULL DEFAULT '',
    "instructions" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SellerPaymentMethod_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SellerPaymentMethod_userId_enabled_idx" ON "SellerPaymentMethod"("userId", "enabled");
CREATE INDEX IF NOT EXISTS "SellerPaymentMethod_userId_kind_idx" ON "SellerPaymentMethod"("userId", "kind");

DO $$ BEGIN
  ALTER TABLE "SellerPaymentMethod" ADD CONSTRAINT "SellerPaymentMethod_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_paymentMethodId_fkey"
    FOREIGN KEY ("paymentMethodId") REFERENCES "SellerPaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
