-- Dedicated warmup timestamps. Does not rewrite money-worker timestamps or purchase rows.

ALTER TABLE "PlatformBalanceCoordination" ADD COLUMN "lastWarmupAt" TIMESTAMP(3);
ALTER TABLE "PlatformBalanceCoordination" ADD COLUMN "lastWarmupCode" TEXT NOT NULL DEFAULT '';
