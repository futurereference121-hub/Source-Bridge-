-- Additive pricing policy identity for new agreements.
-- Empty default preserves recorded fees on existing rows.

ALTER TABLE "PaymentTicket" ADD COLUMN "pricingPolicy" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ProtectedTransaction" ADD COLUMN "pricingPolicy" TEXT NOT NULL DEFAULT '';
