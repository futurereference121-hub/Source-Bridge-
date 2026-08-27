-- Dual-mode Stripe Connect isolation: one Connect account row per (userId, stripeMode).
-- Non-destructive: preserves existing TEST stripeAccountId rows and history.
-- LIVE onboarding creates a separate row; never overwrites TEST IDs.

-- Normalize any empty/legacy mode to TEST before composite unique.
UPDATE "StripeConnectAccount"
SET "stripeMode" = 'TEST'
WHERE "stripeMode" IS NULL OR TRIM("stripeMode") = '';

-- Drop one-row-per-user unique (blocks TEST+LIVE coexistence).
DROP INDEX IF EXISTS "StripeConnectAccount_userId_key";

-- Composite unique: user may have both TEST and LIVE Connect rows.
CREATE UNIQUE INDEX IF NOT EXISTS "StripeConnectAccount_userId_stripeMode_key"
ON "StripeConnectAccount"("userId", "stripeMode");

-- Lookup aid (composite unique already covers userId prefix scans on most planners).
CREATE INDEX IF NOT EXISTS "StripeConnectAccount_userId_idx"
ON "StripeConnectAccount"("userId");
