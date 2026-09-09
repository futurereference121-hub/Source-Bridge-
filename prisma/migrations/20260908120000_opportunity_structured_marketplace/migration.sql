-- Structured Opportunities marketplace (additive, non-destructive).
-- Historical rows remain LEGACY_GENERAL; lifecycle derived from closedAt/expiresAt.

ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'LEGACY_GENERAL';
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "lifecycle" TEXT NOT NULL DEFAULT 'OPEN';
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "stateChangedAt" TIMESTAMP(3);
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "clientRequestId" TEXT;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "renewCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "renewedFromId" TEXT;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "exposureScore" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "lastExposedAt" TIMESTAMP(3);
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "preExpiryNotifiedAt" TIMESTAMP(3);
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "sourceCity" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "sourceCountry" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "deliveryCity" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "deliveryCountry" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "originCity" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "originCountry" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "travelStartAt" TIMESTAMP(3);
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "travelEndAt" TIMESTAMP(3);
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "budgetMinMinor" INTEGER;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "budgetMaxMinor" INTEGER;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "budgetCurrency" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "quantity" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "deliveryMode" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "alternativesOk" BOOLEAN;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "internationalShipping" BOOLEAN;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "localHandover" BOOLEAN;
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "specialistDetails" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "sizeLimits" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "luggageRestrictions" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "notes" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "photosJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "categoriesJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Opportunity" ADD COLUMN IF NOT EXISTS "marketsJson" TEXT NOT NULL DEFAULT '[]';

-- Backfill lifecycle from existing soft-close / expiry (do not reclassify kind).
UPDATE "Opportunity"
SET "lifecycle" = 'WITHDRAWN',
    "stateChangedAt" = COALESCE("closedAt", "updatedAt", NOW())
WHERE "closedAt" IS NOT NULL
  AND "lifecycle" = 'OPEN';

UPDATE "Opportunity"
SET "lifecycle" = 'EXPIRED',
    "stateChangedAt" = COALESCE("expiresAt", "updatedAt", NOW())
WHERE "closedAt" IS NULL
  AND "expiresAt" IS NOT NULL
  AND "expiresAt" <= NOW()
  AND "lifecycle" = 'OPEN';

-- Seed primary location mirrors for searchable columns when empty.
UPDATE "Opportunity"
SET "sourceCity" = "city",
    "sourceCountry" = "country"
WHERE ("sourceCity" = '' OR "sourceCountry" = '')
  AND "city" <> ''
  AND "country" <> '';

CREATE INDEX IF NOT EXISTS "Opportunity_kind_lifecycle_expiresAt_idx"
  ON "Opportunity"("kind", "lifecycle", "expiresAt");
CREATE INDEX IF NOT EXISTS "Opportunity_lifecycle_postedAt_idx"
  ON "Opportunity"("lifecycle", "postedAt");
CREATE INDEX IF NOT EXISTS "Opportunity_lifecycle_expiresAt_idx"
  ON "Opportunity"("lifecycle", "expiresAt");
CREATE INDEX IF NOT EXISTS "Opportunity_sourceCountry_sourceCity_idx"
  ON "Opportunity"("sourceCountry", "sourceCity");
CREATE INDEX IF NOT EXISTS "Opportunity_deliveryCountry_deliveryCity_idx"
  ON "Opportunity"("deliveryCountry", "deliveryCity");
CREATE INDEX IF NOT EXISTS "Opportunity_country_city_idx"
  ON "Opportunity"("country", "city");
CREATE INDEX IF NOT EXISTS "Opportunity_travelEndAt_idx"
  ON "Opportunity"("travelEndAt");
CREATE INDEX IF NOT EXISTS "Opportunity_userId_clientRequestId_idx"
  ON "Opportunity"("userId", "clientRequestId");
CREATE INDEX IF NOT EXISTS "Opportunity_exposureScore_postedAt_idx"
  ON "Opportunity"("exposureScore", "postedAt");
